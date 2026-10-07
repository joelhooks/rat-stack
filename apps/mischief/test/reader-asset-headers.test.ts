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
import { ReaderFlags } from "../../web/src/client/reader-model.js";
import type { ReaderModel } from "../../web/src/client/reader-model.js";

class PreparedReaderPages extends Context.Service<
  PreparedReaderPages,
  { readonly pages: readonly ReaderModel[] }
>()("test/PreparedReaderPages") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* prepareFixture() {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();

      yield* prepareReader(root).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({})
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
    isPreview: boolean
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

    if (isPreview) {
      expect(robots).toBe("noindex");
    } else {
      expect(robots).not.toBe("noindex");
    }

    expect(canonicals).toHaveLength(1);
    expect(canonicals.at(0)?.attribs.href).toBe(canonical);
  }
);

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
        const routes = ["/", "/lore/services-capture-dependencies"];
        const encodedPages = Schema.fromJsonString(Schema.Array(ReaderFlags));

        const { pages } = yield* PreparedReaderPages;

        const writeStage = Effect.fn("writeReaderStageFixture")(
          function* writeStage(origin: string, robots: "index" | "noindex") {
            const staged = pages.map((page) => ({
              ...page,
              origin,
              page: {
                ...page.page,
                metadata: { ...page.page.metadata, robots },
              },
            }));

            yield* fs.writeFileString(
              path.join(root, "dist/reader-pages.json"),
              yield* Schema.encodeEffect(encodedPages)(staged)
            );
          }
        );

        const commit = preview.seed.toString(16).padStart(40, "0");
        const origin = `https://pr-${preview.number}.ratstack.sh`;
        const headerPath = path.join(client, "_headers");

        const outputPath = (route: string) =>
          route === "/"
            ? path.join(client, "index.html")
            : path.join(client, route, "index.html");

        for (const route of routes) {
          const output = outputPath(route);
          yield* fs.makeDirectory(path.dirname(output), { recursive: true });
          yield* fs.writeFileString(
            output,
            '<!doctype html><html><head><title>Template</title><link rel="stylesheet" href="/assets/site.css"></head><body><main>Reader content</main></body></html>'
          );
        }

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
        ]);

        for (const route of routes) {
          yield* assertMetadata(outputPath(route), `${origin}${route}`, true);
        }

        yield* writeStage("https://ratstack.sh", "index");
        yield* finalizeReader(root, client).pipe(
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromUnknown({})
          )
        );

        expect(yield* fs.exists(headerPath)).toBe(false);

        for (const route of routes) {
          yield* assertMetadata(
            outputPath(route),
            `https://ratstack.sh${route}`,
            false
          );
        }
      }),
    { arbitrary: { runs: 100 } }
  );
});
