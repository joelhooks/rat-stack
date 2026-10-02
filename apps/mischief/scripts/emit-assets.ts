import { Effect, FileSystem, Path, Schema } from "effect";

import { buildError } from "./content-error.ts";

export const ContentAssetManifest = Schema.Struct({
  images: Schema.Array(Schema.String),
  pages: Schema.Array(
    Schema.Struct({
      html: Schema.String,
      markdown: Schema.String,
      route: Schema.String,
    })
  ),
});

interface AssetPage {
  readonly routePath: string;
  readonly documentHtml: string;
  readonly text: string;
}

interface AssetImage {
  readonly path: string;
  readonly base64: string;
}

export const emitAssets = Effect.fn("emitAssets")(
  function* writeContentAssets(input: {
    readonly directory: string;
    readonly pages: readonly AssetPage[];
    readonly images: readonly AssetImage[];
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.dirname(input.directory), { recursive: true });

    const temporary = yield* fs.makeTempDirectoryScoped({
      directory: path.dirname(input.directory),
      prefix: ".content-assets.",
    });

    const staging = path.join(temporary, "content");
    const assets = path.join(staging, "assets");
    yield* fs.makeDirectory(assets, { recursive: true });
    const pages: (typeof ContentAssetManifest.Type.pages)[number][] = [];

    for (const page of input.pages) {
      const name = page.routePath === "/" ? "/index" : page.routePath;
      const html = `${name}.html`;
      const markdown = `${name}.md`;
      yield* fs.makeDirectory(path.dirname(path.join(assets, html.slice(1))), {
        recursive: true,
      });
      yield* fs.writeFileString(
        path.join(assets, html.slice(1)),
        page.documentHtml
      );
      yield* fs.writeFileString(
        path.join(assets, markdown.slice(1)),
        page.text
      );
      pages.push({ html, markdown, route: page.routePath });
    }

    for (const image of input.images) {
      const output = path.join(assets, image.path.slice(1));
      yield* fs.makeDirectory(path.dirname(output), { recursive: true });
      yield* fs.writeFile(output, Buffer.from(image.base64, "base64"));
    }

    yield* fs.writeFileString(
      path.join(staging, "manifest.json"),
      JSON.stringify({ images: input.images.map((image) => image.path), pages })
    );
    yield* fs.remove(input.directory, { force: true, recursive: true });
    yield* fs.rename(staging, input.directory);
  },
  Effect.scoped,
  Effect.mapError((cause) => buildError("emit assets", "content assets", cause))
);
