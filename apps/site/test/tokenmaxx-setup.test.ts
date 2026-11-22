import { NodeCrypto, NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import * as Digest from "effect/crypto/Digest";
import { HttpRouter } from "effect/http";

import { mischiefRoutes } from "../src/app.js";
import { StaticAssets } from "../src/static-assets.js";
import { TestSandbox } from "./test-sandbox.js";

const setupPath = "/tokenmaxx/setup.md";

const withSetupHandler = <A, E, R>(
  use: (
    handler: (request: Request) => Promise<Response>
  ) => Effect.Effect<A, E, R>,
  raw?: Uint8Array
) =>
  Effect.gen(function* serveSetup() {
    const files = yield* StaticAssets;

    const assets = StaticAssets.of({
      read: (path) =>
        path === setupPath && raw !== undefined
          ? Effect.succeed(raw)
          : files.read(path),
    });

    return yield* Effect.acquireUseRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(
          mischiefRoutes({ assets }).pipe(Layer.provide(TestSandbox)),
          { disableLogger: true }
        )
      ),
      ({ handler }) => use(handler),
      ({ dispose }) => Effect.promise(dispose)
    );
  }).pipe(Effect.provide(TestSandbox));

it.effect(
  "serves authored setup bytes on GET and headers on HEAD without publishing it in the sitemap",
  () =>
    Effect.gen(function* authoredSetup() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const source = yield* fs.readFile(
        path.resolve(import.meta.dirname, "../content/tokenmaxx/setup.md")
      );

      yield* withSetupHandler((handler) =>
        Effect.gen(function* fetchSetup() {
          for (const method of ["GET", "HEAD"]) {
            for (const accept of [
              undefined,
              "*/*",
              "text/html",
              "application/json",
              "text/markdown",
            ]) {
              const response = yield* Effect.promise(() =>
                handler(
                  new Request(`https://ratstack.sh${setupPath}`, {
                    headers: accept === undefined ? {} : { accept },
                    method,
                  })
                )
              );

              expect(response.status).toBe(200);
              expect(response.headers.get("content-type")).toBe(
                "text/markdown; charset=utf-8"
              );
              expect(response.headers.get("x-robots-tag")).toBe("noindex");

              const body = new Uint8Array(
                yield* Effect.promise(() => response.arrayBuffer())
              );

              expect(body).toEqual(
                method === "HEAD" ? new Uint8Array() : new Uint8Array(source)
              );
            }
          }

          const sitemap = yield* Effect.promise(() =>
            handler(new Request("https://ratstack.sh/sitemap.xml"))
          );

          expect(sitemap.status).toBe(200);
          expect(yield* Effect.promise(() => sitemap.text())).not.toContain(
            setupPath
          );
        })
      );
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect("renders the seven approved steps on the workshop prep page", () =>
  withSetupHandler((handler) =>
    Effect.gen(function* publishedPrepPage() {
      const response = yield* Effect.promise(() =>
        handler(new Request("https://ratstack.sh/tokenmaxx/prep"))
      );

      const body = yield* Effect.promise(() => response.text());

      expect(response.status).toBe(200);
      expect(body).not.toContain("Coming soon.");

      for (const [index, label] of [
        "Node, pnpm, git and Pi",
        "The workshop tools",
        "Herdr",
        "The person gives Pi a model",
        "The check",
        "The person's own repo",
        "Report",
      ].entries()) {
        expect(body).toContain(
          `${index + 1}. [${label}](https://ratstack.sh/tokenmaxx/setup.md)`
        );
      }
    })
  )
);

it.effect(
  "serves the workshop picture with the source SHA-256, JPEG type and noindex",
  () =>
    Effect.gen(function* workshopPicture() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const digest = yield* Digest.Digest;

      const imagePath = "/tokenmaxx/shitrat.jpg";

      const source = yield* fs.readFile(
        path.resolve(import.meta.dirname, "../content/tokenmaxx/shitrat.jpg")
      );

      const sourceHash = yield* digest.digestHex(Digest.sha256, source);

      yield* withSetupHandler((handler) =>
        Effect.gen(function* fetchPicture() {
          for (const method of ["GET", "HEAD"]) {
            const response = yield* Effect.promise(() =>
              handler(
                new Request(`https://ratstack.sh${imagePath}`, { method })
              )
            );

            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toBe("image/jpeg");
            expect(response.headers.get("x-robots-tag")).toBe("noindex");

            const bytes = new Uint8Array(
              yield* Effect.promise(() => response.arrayBuffer())
            );

            if (method === "HEAD") {
              expect(bytes.byteLength).toBe(0);
            } else {
              expect(yield* digest.digestHex(Digest.sha256, bytes)).toBe(
                sourceHash
              );
            }
          }

          const sitemap = yield* Effect.promise(() =>
            handler(new Request("https://ratstack.sh/sitemap.xml"))
          );

          expect(sitemap.status).toBe(200);
          expect(yield* Effect.promise(() => sitemap.text())).not.toContain(
            imagePath
          );
        })
      );
    }).pipe(
      Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layerDigest))
    )
);

it.effect.prop(
  "preserves raw setup markdown including origin tokens, glossary terms, frontmatter and unicode",
  { text: Arbitrary.schema(Schema.String) },
  ({ text }) => {
    const source = new TextEncoder().encode(
      `---\ntitle: raw\n---\n__RATSTACK_ORIGIN__ Effect capability 🐀 日本語\n\`code\`\n${text}`
    );

    return withSetupHandler(
      (handler) =>
        Effect.gen(function* rawSetupParity() {
          const response = yield* Effect.promise(() =>
            handler(
              new Request(`https://ratstack.sh${setupPath}`, {
                headers: { accept: "text/html" },
              })
            )
          );

          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toBe(
            "text/markdown; charset=utf-8"
          );
          expect(response.headers.get("x-robots-tag")).toBe("noindex");
          expect(
            new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()))
          ).toEqual(source);
        }),
      source
    );
  }
);
