// @effect-diagnostics-next-line nodeBuiltinImport:off -- Build-only content addressing uses Node's SHA-256 implementation.
import { createHash } from "node:crypto";

import { Effect, FileSystem, Path, Schema } from "effect";

import { ContentAssetManifest } from "../src/asset-manifest.ts";
import { buildError } from "./content-error.ts";

export { ContentAssetManifest } from "../src/asset-manifest.ts";

interface AssetPage {
  readonly routePath: string;
  readonly documentHtml: string;
  readonly text: string;
}

interface AssetImage {
  readonly path: string;
  readonly base64: string;
}

interface AssetContent {
  readonly pages: readonly AssetPage[];
  readonly images: readonly AssetImage[];
  readonly data?: readonly {
    readonly path: string;
    readonly value: Schema.Json;
  }[];
}

export const contentAssetGeneration = (input: AssetContent) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        data: input.data,
        images: input.images,
        pages: input.pages,
      })
    )
    .digest("hex");

export const emitAssets = Effect.fn("emitAssets")(
  function* writeContentAssets(
    input: AssetContent & { readonly directory: string }
  ) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.dirname(input.directory), { recursive: true });

    const temporary = yield* fs.makeTempDirectoryScoped({
      directory: path.dirname(input.directory),
      prefix: ".content-assets.",
    });

    const generation = contentAssetGeneration(input);

    const assets = path.join(input.directory, "assets", generation);
    yield* fs.makeDirectory(assets, { recursive: true });
    const pages: (typeof ContentAssetManifest.Type.pages)[number][] = [];

    for (const page of input.pages) {
      const name = page.routePath === "/" ? "/index" : page.routePath;
      const html = `${name}.html`;
      const markdown = `${name}.md`;
      yield* fs.makeDirectory(path.dirname(path.join(assets, html.slice(1))), {
        recursive: true,
      });
      const temporaryHtml = path.join(temporary, "page.html");
      const temporaryMarkdown = path.join(temporary, "page.md");
      yield* fs.writeFileString(temporaryHtml, page.documentHtml);
      yield* fs.writeFileString(temporaryMarkdown, page.text);
      yield* fs.rename(temporaryHtml, path.join(assets, html.slice(1)));
      yield* fs.rename(temporaryMarkdown, path.join(assets, markdown.slice(1)));
      pages.push({ html, markdown, route: page.routePath });
    }

    for (const image of input.images) {
      const output = path.join(assets, image.path.slice(1));
      yield* fs.makeDirectory(path.dirname(output), { recursive: true });
      const temporaryImage = path.join(temporary, "image");
      yield* fs.writeFile(temporaryImage, Buffer.from(image.base64, "base64"));
      yield* fs.rename(temporaryImage, output);
    }

    for (const record of input.data ?? []) {
      const output = path.join(assets, record.path.slice(1));
      yield* fs.makeDirectory(path.dirname(output), { recursive: true });
      const temporaryData = path.join(temporary, "data.json");
      yield* fs.writeFileString(
        temporaryData,
        JSON.stringify({ data: record.value, generation })
      );
      yield* fs.rename(temporaryData, output);
    }

    const manifest = {
      data: input.data?.map((record) => record.path),
      generation,
      images: input.images.map((image) => image.path),
      pages,
    };

    const temporaryManifest = path.join(temporary, "manifest.json");
    yield* fs.writeFileString(temporaryManifest, JSON.stringify(manifest));
    const manifestPath = path.join(input.directory, "manifest.json");
    yield* fs.rename(temporaryManifest, manifestPath);

    for (const entry of yield* fs.readDirectory(
      path.join(input.directory, "assets")
    )) {
      const current = yield* Schema.decodeEffect(
        Schema.fromJsonString(ContentAssetManifest)
      )(yield* fs.readFileString(manifestPath));

      if (entry !== generation && entry !== current.generation) {
        yield* fs.remove(path.join(input.directory, "assets", entry), {
          force: true,
          recursive: true,
        });
      }
    }

    return manifest;
  },
  Effect.scoped,
  Effect.mapError((cause) => buildError("emit assets", "content assets", cause))
);
