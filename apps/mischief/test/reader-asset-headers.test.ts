import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  Arbitrary,
  ConfigProvider,
  Context,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
} from "effect";
import { DomUtils, parseDocument } from "htmlparser2";

import {
  finalizeReader,
  prepareReader,
} from "../../web/scripts/reader-build.ts";
import { ReaderFlags } from "../../web/src/client/reader/model.js";
import type { ReaderPageFlags } from "../../web/src/client/reader/model.js";
import { readerNoStoreRoutePaths } from "../../web/src/reader-routes.js";
import {
  renderDocument,
  withReaderHead,
} from "../../web/src/server/reader-document.js";

class PreparedReaderPages extends Context.Service<
  PreparedReaderPages,
  { readonly pages: readonly ReaderPageFlags[] }
>()("test/PreparedReaderPages") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* prepareFixture() {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();

      yield* prepareReader(root).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({
            PREVIEW_ORIGIN: "https://pr-999.ratstack.sh",
          })
        )
      );

      const pages = yield* Schema.decodeEffect(
        Schema.fromJsonString(Schema.Array(ReaderFlags))
      )(yield* fs.readFileString(`${root}/dist/reader-pages.json`));

      return { pages };
    })
  ).pipe(Layer.provideMerge(NodeServices.layer));
}

const previewStage = Arbitrary.schema(
  Schema.Struct({
    number: Schema.Int.check(Schema.isBetween({ maximum: 10_000, minimum: 1 })),
    seed: Schema.Int.check(Schema.isBetween({ maximum: 65_535, minimum: 0 })),
  })
);

const assertMetadata = Effect.fn("assertReaderAssetMetadata")(
  function* assertMetadata(
    file: string,
    canonical: string,
    expectedRobots: "index" | "noindex"
  ) {
    const fs = yield* FileSystem.FileSystem;
    const html = yield* fs.readFileString(file);

    const document = parseDocument(html);
    const metas = DomUtils.getElementsByTagName("meta", document.children);

    const robots = metas.find((element) => element.attribs.name === "robots")
      ?.attribs.content;

    const links = DomUtils.getElementsByTagName("link", document.children);

    const canonicals = links.filter(
      (element) => element.attribs.rel === "canonical"
    );

    if (expectedRobots === "noindex") {
      expect(robots).toBe("noindex");
    } else {
      expect(robots).not.toBe("noindex");
    }

    expect(canonicals).toHaveLength(1);
    expect(canonicals.at(0)?.attribs.href).toBe(canonical);
  }
);

const assertProductionPayloads = (pages: readonly ReaderPageFlags[]) => {
  for (const page of pages) {
    expect(page.origin).toBe("https://ratstack.sh");

    const payloads = [
      ...page.copyPrompts.map((prompt) => prompt.text),
      ...page.codeFences.flatMap((fence) => [fence.value, fence.html]),
      JSON.stringify(page.blocks),
    ];

    for (const payload of payloads) {
      expect(payload).not.toMatch(/https:\/\/pr-\d+\.ratstack\.sh/u);
      expect(payload).not.toContain("__RATSTACK_ORIGIN__");
    }
  }

  const home = pages.find((page) => page.page.path === "/");
  expect(
    home?.copyPrompts.find((prompt) => prompt.id === "mcp")?.text
  ).toContain("https://ratstack.sh/mcp");
  expect(
    home?.codeFences.find((fence) => fence.value.includes("claude mcp add"))
      ?.value
  ).toContain("https://ratstack.sh/mcp");
};

it.layer(PreparedReaderPages.layer)((test) => {
  test.effect.prop(
    "preview output cannot leave indexing headers or preview canonicals in a later production build",
    { preview: previewStage },
    ({ preview }) =>
      Effect.gen(function* assetHeaderTransition() {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped();
        const client = path.join(root, "dist/client");

        const encodedPages = Schema.fromJsonString(Schema.Array(ReaderFlags));

        const { pages: prepared } = yield* PreparedReaderPages;
        assertProductionPayloads(prepared);

        const pages = prepared.filter(
          (page, index) =>
            page.page.path === "/" || index === preview.seed % prepared.length
        );

        const routes = pages.map((page) => page.page.path);

        const noStoreRules = routes.flatMap((route) =>
          readerNoStoreRoutePaths.includes(route)
            ? [route, "Cache-Control: no-store"]
            : []
        );

        const productionRules = pages.flatMap((page) => {
          const lines = [
            ...(readerNoStoreRoutePaths.includes(page.page.path)
              ? ["Cache-Control: no-store"]
              : []),
            ...(page.page.metadata.robots === "noindex"
              ? ["X-Robots-Tag: noindex"]
              : []),
          ];

          return lines.length === 0 ? [] : [page.page.path, ...lines];
        });

        const outputPath = (route: string) =>
          route === "/"
            ? path.join(client, "index.html")
            : path.join(client, route, "index.html");

        const writeStage = Effect.fn("writeReaderStageFixture")(
          function* writeStage(origin: string, robots?: "index" | "noindex") {
            const staged = pages.map((page) => ({
              ...page,
              origin,
              page: {
                ...page.page,
                metadata: {
                  ...page.page.metadata,
                  robots: robots ?? page.page.metadata.robots,
                },
              },
            }));

            yield* fs.makeDirectory(path.join(root, "dist"), {
              recursive: true,
            });
            yield* fs.writeFileString(
              path.join(root, "dist/reader-pages.json"),
              yield* Schema.encodeEffect(encodedPages)(staged)
            );

            for (const page of staged) {
              const output = outputPath(page.page.path);
              yield* fs.makeDirectory(path.dirname(output), {
                recursive: true,
              });
              yield* fs.writeFileString(
                output,
                renderDocument(
                  withReaderHead(
                    {
                      canonical: `${origin}${page.page.metadata.canonicalPath}`,
                      html: "<main>Reader content</main>",
                      ogUrl: `${origin}${page.page.metadata.canonicalPath}`,
                      title: page.page.metadata.title,
                    },
                    page
                  ),
                  {
                    entryScript: "/assets/site.js",
                    modulePreloads: [],
                    stylesheets: ["/assets/site.css"],
                  }
                )
              );
            }
          }
        );

        const commit = preview.seed.toString(16).padStart(40, "0");
        const origin = `https://pr-${preview.number}.ratstack.sh`;
        const headerPath = path.join(client, "_headers");

        yield* writeStage(origin, "noindex");
        yield* finalizeReader(root, client).pipe(
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromUnknown({
              PREVIEW_COMMIT: commit,
              PREVIEW_ORIGIN: origin,
            })
          )
        );

        expect(
          (yield* fs.readFileString(headerPath))
            .trim()
            .split("\n")
            .map((line) => line.trim())
        ).toEqual([
          "/*",
          "X-Robots-Tag: noindex",
          `X-Preview-Commit: ${commit}`,
          ...noStoreRules,
        ]);

        for (const route of routes) {
          yield* assertMetadata(
            outputPath(route),
            `${origin}${route}`,
            "noindex"
          );
        }

        yield* writeStage("https://ratstack.sh");
        yield* finalizeReader(root, client).pipe(
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromUnknown({})
          )
        );

        if (productionRules.length === 0) {
          expect(yield* fs.exists(headerPath)).toBe(false);
        } else {
          expect(
            (yield* fs.readFileString(headerPath))
              .trim()
              .split("\n")
              .map((line) => line.trim())
          ).toEqual(productionRules);
        }

        for (const page of pages) {
          yield* assertMetadata(
            outputPath(page.page.path),
            `https://ratstack.sh${page.page.path}`,
            page.page.metadata.robots
          );
        }
      }),
    { arbitrary: { runs: 100 } }
  );
});
