import { pathToFileURL } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { readerHtmlProof } from "../../site/test/reader-html-proof.js";
import { runViteBuildChild } from "../node_modules/alchemy/lib/Cloudflare/Workers/ViteChild.js";
import { proveWebsiteWorkerd } from "./website-workerd.js";

const workerProbe = String.raw`
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const payload = JSON.parse(input);
const bindings = {
  PREVIEW_COMMIT: payload.commit,
  BACKEND: { fetch: async () => new Response("private RPC binding", { status: 200 }) },
  ASSETS: { fetch: async (request) => {
    const pathname = new URL(request.url).pathname;
    const base = payload.clientDirectory + (pathname === "/" ? "/index.html" : pathname);
    for (const file of [base, base + "/index.html"]) {
      try { return new Response(await readFile(file), { status: 200 }); } catch {}
    }
    return new Response("Not found", { status: 404 });
  } },
};
globalThis.__readerProbeBindings = bindings;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return {
    url: "data:text/javascript,export const env = globalThis.__readerProbeBindings",
    shortCircuit: true,
  };
  return next(specifier, context);
} });
const { default: worker } = await import(payload.entry);
const responses = [];
for (const path of payload.paths) {
  const response = await worker.fetch(new Request("https://pr-40.ratstack.sh" + path), bindings);
  responses.push({ path, status: response.status, commit: response.headers.get("x-preview-commit"), noindex: response.headers.get("x-robots-tag"), text: await response.text() });
}
hooks.deregister();
process.stdout.write(JSON.stringify(responses));
`;

const ProbeResponses = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      commit: Schema.NullOr(Schema.String),
      noindex: Schema.NullOr(Schema.String),
      path: Schema.String,
      status: Schema.Finite,
      text: Schema.String,
    })
  )
);

it.layer(NodeServices.layer)((test) => {
  test.effect(
    "Alchemy selects the reader and RpcBackend evaluates without import.meta.url to serve native RPC",
    () =>
      Effect.gen(function* websiteProductionBuild() {
        const result = yield* runViteBuildChild(
          {
            compatibilityDate: "2026-05-28",
            compatibilityFlags: ["nodejs_compat"],
            env: {},
            main: undefined,
            rootDir: new URL("../../web/", import.meta.url).pathname,
            viteEnvironments: undefined,
          },
          (_channel, line) => Effect.log(line)
        );

        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        if (
          result.clientDirectory === undefined ||
          result.serverBundle === undefined
        ) {
          return yield* Effect.die(
            new Error(
              "Alchemy must emit both client assets and the Website Worker"
            )
          );
        }

        const home = yield* fs.readFileString(
          path.join(result.clientDirectory, "index.html")
        );

        const lore = yield* fs.readFileString(
          path.join(
            result.clientDirectory,
            "lore/services-capture-dependencies/index.html"
          )
        );

        const pages = yield* Schema.decodeEffect(
          Schema.fromJsonString(
            Schema.Array(
              Schema.Struct({
                heading: Schema.String,
                origin: Schema.String,
                page: Schema.Struct({
                  metadata: Schema.Struct({
                    canonicalPath: Schema.String,
                    robots: Schema.String,
                    title: Schema.String,
                  }),
                  path: Schema.String,
                }),
              })
            )
          )
        )(
          yield* fs.readFileString(
            new URL("../../web/dist/reader-pages.json", import.meta.url)
              .pathname
          )
        );

        const documents: readonly (readonly [string, string])[] = [
          ["/", home],
          ["/lore/services-capture-dependencies", lore],
          [
            "/news",
            yield* fs.readFileString(
              path.join(result.clientDirectory, "news/index.html")
            ),
          ],
          [
            "/directory",
            yield* fs.readFileString(
              path.join(result.clientDirectory, "directory/index.html")
            ),
          ],
        ];

        for (const [route, html] of documents) {
          const page = pages.find((candidate) => candidate.page.path === route);
          expect(page).toBeDefined();

          const proof = readerHtmlProof(html);
          expect(proof.headingCount).toBe(1);
          expect(proof.heading).toBe(page?.heading);
          expect(proof.titleCount).toBe(1);
          expect(proof.title).toBe(page?.page.metadata.title);
          expect(proof.canonicalCount).toBe(1);
          expect(proof.canonical).toBe(
            `${page?.origin}${page?.page.metadata.canonicalPath}`
          );

          if (page?.origin === "https://ratstack.sh") {
            expect(proof.robots).not.toBe("noindex");

            const headerPath = path.join(result.clientDirectory, "_headers");

            const headers = (yield* fs.exists(headerPath))
              ? yield* fs.readFileString(headerPath)
              : "";

            expect(headers).not.toMatch(/^\/\*$/mu);
            expect(headers).not.toContain("X-Preview-Commit");
          } else {
            expect(proof.robots).toBe("noindex");
          }
        }

        const references = [
          ...new Set(
            [
              ...`${home}${lore}`.matchAll(
                /(?:src|href)="(?<asset>\/assets\/[^"#?]+)"/gu
              ),
            ].flatMap((match) => {
              const asset = match.groups?.asset;

              return asset === undefined ? [] : [asset];
            })
          ),
        ];

        expect(references.length).toBeGreaterThan(0);

        for (const reference of references) {
          expect(
            yield* fs.exists(path.join(result.clientDirectory, reference))
          ).toBe(true);
        }

        const directory = yield* fs.makeTempDirectoryScoped({
          directory: new URL("../../web/dist/", import.meta.url).pathname,
          prefix: "worker-probe-",
        });

        for (const file of result.serverBundle.files) {
          const destination = path.join(directory, file.path);
          yield* fs.makeDirectory(path.dirname(destination), {
            recursive: true,
          });

          const content = Schema.is(Schema.String)(file.content)
            ? new TextEncoder().encode(file.content)
            : file.content;

          yield* fs.writeFile(destination, content);
        }

        const commit = "c67faffd626f94ebec3e734c02398a2d86f5e830";
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

        const child = yield* spawner.spawn(
          ChildProcess.make(
            process.execPath,
            ["--input-type=module", "-e", workerProbe],
            {
              stdin: Stream.succeed(
                new TextEncoder().encode(
                  JSON.stringify({
                    clientDirectory: result.clientDirectory,
                    commit,
                    entry: pathToFileURL(
                      path.join(directory, result.serverBundle.files[0].path)
                    ).href,
                    paths: [
                      "/",
                      "/lore/services-capture-dependencies",
                      "/news",
                      "/directory",
                      "/rpc",
                      "/__rat",
                      "/outside-the-slice",
                    ],
                  })
                )
              ),
            }
          )
        );

        const output = yield* child.stdout.pipe(
          Stream.decodeText(),
          Stream.mkString
        );

        expect(yield* child.exitCode).toBe(0);

        const responses = yield* Schema.decodeEffect(ProbeResponses)(output);

        for (const response of responses) {
          expect(response.commit).toBe(commit);
          expect(response.noindex).toBe("noindex");
          expect(response.status).toBe(
            response.path === "/outside-the-slice" || response.path === "/__rat"
              ? 404
              : 200
          );
        }

        expect(
          responses.find((response) => response.path === "/rpc")?.text
        ).toBe("private RPC binding");

        const native = yield* proveWebsiteWorkerd(result.serverBundle, commit);
        yield* fs.writeFileString(
          new URL("../../web/dist/reader-workerd-proof.json", import.meta.url)
            .pathname,
          JSON.stringify({ commit, ...native })
        );

        return responses;
      }),
    { timeout: 120_000 }
  );
});
