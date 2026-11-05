import { Effect, FileSystem, Path, Schema } from "effect";
import * as Digest from "effect/crypto/Digest";

import { ContentAssetManifest } from "./asset-manifest.js";

export class AssetDeploymentError extends Schema.TaggedError<
  AssetDeploymentError,
  { readonly brand: unique symbol }
>()("AssetDeploymentError", {
  cause: Schema.Defect(),
  generation: Schema.String,
  path: Schema.String,
  reason: Schema.Literals([
    "manifest",
    "generation",
    "routes",
    "images",
    "data",
    "directory",
    "file",
  ]),
}) {}

export interface RuntimeAssets {
  readonly pages?: readonly string[];
  readonly images?: readonly string[];
  readonly data?: readonly string[];
}

export const assetDirectoryForBuild = (
  directory: string,
  runtime: RuntimeAssets & { readonly generation: string }
) =>
  Effect.gen(function* selectAssetDirectory() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const manifestPath = path.join(directory, "manifest.json");

    const failure = (
      reason: AssetDeploymentError["reason"],
      target: string,
      cause: unknown
    ) =>
      new AssetDeploymentError({
        cause,
        generation: runtime.generation,
        path: target,
        reason,
      });

    const manifest = yield* fs.readFileString(manifestPath).pipe(
      Effect.flatMap(
        Schema.decodeEffect(Schema.fromJsonString(ContentAssetManifest))
      ),
      Effect.mapError((cause) => failure("manifest", manifestPath, cause))
    );

    if (manifest.generation !== runtime.generation) {
      return yield* failure("generation", manifestPath, manifest.generation);
    }

    const pages = new Set(
      runtime.pages ?? manifest.pages.map((page) => page.route)
    );

    const images = new Set(runtime.images ?? manifest.images);

    if (
      ![...pages].every((route) =>
        manifest.pages.some((page) => page.route === route)
      ) ||
      !manifest.pages.every((page) => {
        const stem = page.route === "/" ? "/index" : page.route;

        return page.markdown === `${stem}.md`;
      })
    ) {
      return yield* failure("routes", manifestPath, manifest.pages);
    }

    if (![...images].every((image) => manifest.images.includes(image))) {
      return yield* failure("images", manifestPath, manifest.images);
    }

    const data = new Set(runtime.data ?? manifest.data);

    if (![...data].every((file) => manifest.data?.includes(file) === true)) {
      return yield* failure("data", manifestPath, [...data]);
    }

    const assets = path.join(directory, "assets", runtime.generation);

    const stat = yield* fs
      .stat(assets)
      .pipe(Effect.mapError((cause) => failure("directory", assets, cause)));

    if (stat.type !== "Directory") {
      return yield* failure("directory", assets, stat.type);
    }

    const files = [
      ...manifest.pages
        .filter((page) => pages.has(page.route))
        .map((page) => page.markdown),
      ...images,
      ...data,
    ].toSorted();

    for (const file of files) {
      const target = path.join(assets, file.slice(1));

      const info = yield* fs
        .stat(target)
        .pipe(Effect.mapError((cause) => failure("file", target, cause)));

      if (info.type !== "File" || info.size === 0n) {
        return yield* failure("file", target, info.type);
      }
    }

    if (
      pages.size === manifest.pages.length &&
      images.size === manifest.images.length &&
      data.size === (manifest.data?.length ?? 0)
    ) {
      return assets;
    }

    const digest = yield* Digest.Digest;

    const selection = yield* digest.digestHex(
      Digest.sha256,
      new TextEncoder().encode(JSON.stringify(files))
    );

    const selections = path.join(directory, "selections", runtime.generation);
    const selected = path.join(selections, selection);

    yield* Effect.gen(function* materializeSelection() {
      yield* fs.makeDirectory(selections, { recursive: true });

      if (!(yield* fs.exists(selected))) {
        const temporary = yield* fs.makeTempDirectoryScoped({
          directory: selections,
          prefix: ".selection.",
        });

        for (const file of files) {
          const target = path.join(temporary, file.slice(1));
          yield* fs.makeDirectory(path.dirname(target), { recursive: true });
          yield* fs.copyFile(path.join(assets, file.slice(1)), target);
        }

        yield* fs.rename(temporary, selected);
      }
    }).pipe(Effect.mapError((cause) => failure("directory", selected, cause)));

    return selected;
  }).pipe(
    Effect.withSpan("assetDirectoryForBuild"),
    Effect.provide(Digest.layerWebCrypto),
    Effect.scoped
  );

export const contentAssetsForBuild = (
  directory: string,
  generation: string,
  runtime: RuntimeAssets = {}
) =>
  Effect.gen(function* selectContentAssets() {
    const assets =
      globalThis.__ALCHEMY_RUNTIME__ === true
        ? undefined
        : yield* assetDirectoryForBuild(directory, { ...runtime, generation });

    return assets === undefined
      ? assets
      : {
          directory: assets,
          htmlHandling: "none" as const,
          runWorkerFirst: true,
        };
  });
