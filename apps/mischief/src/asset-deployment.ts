import { Effect, FileSystem, Path, Schema } from "effect";

import { ContentAssetManifest } from "./asset-manifest.js";

export class AssetDeploymentError extends Schema.TaggedError<AssetDeploymentError>()(
  "AssetDeploymentError",
  {
    cause: Schema.Defect(),
    generation: Schema.String,
    path: Schema.String,
    reason: Schema.Literals([
      "manifest",
      "generation",
      "routes",
      "images",
      "directory",
      "file",
    ]),
  }
) {}

export const assetDirectoryForBuild = Effect.fn("assetDirectoryForBuild")(
  function* assetDirectoryForBuild(
    directory: string,
    runtime: {
      readonly generation: string;
      readonly pages?: readonly string[];
      readonly images?: readonly string[];
    }
  ) {
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
      manifest.pages.length !== pages.size ||
      !manifest.pages.every((page) => {
        const stem = page.route === "/" ? "/index" : page.route;

        return (
          pages.has(page.route) &&
          page.html === `${stem}.html` &&
          page.markdown === `${stem}.md`
        );
      })
    ) {
      return yield* failure("routes", manifestPath, manifest.pages);
    }

    if (
      manifest.images.length !== images.size ||
      !manifest.images.every((image) => images.has(image))
    ) {
      return yield* failure("images", manifestPath, manifest.images);
    }

    const assets = path.join(directory, "assets", runtime.generation);

    const stat = yield* fs
      .stat(assets)
      .pipe(Effect.mapError((cause) => failure("directory", assets, cause)));

    if (stat.type !== "Directory") {
      return yield* failure("directory", assets, stat.type);
    }

    for (const file of [
      ...manifest.pages.flatMap((page) => [page.html, page.markdown]),
      ...manifest.images,
      ...(manifest.data ?? []),
    ]) {
      const target = path.join(assets, file.slice(1));

      const info = yield* fs
        .stat(target)
        .pipe(Effect.mapError((cause) => failure("file", target, cause)));

      if (info.type !== "File" || info.size === 0n) {
        return yield* failure("file", target, info.type);
      }
    }

    return assets;
  }
);

export const contentAssetsForBuild = (directory: string, generation: string) =>
  Effect.gen(function* selectContentAssets() {
    const assets =
      globalThis.__ALCHEMY_RUNTIME__ === true
        ? undefined
        : yield* assetDirectoryForBuild(directory, { generation });

    return assets === undefined
      ? assets
      : {
          directory: assets,
          htmlHandling: "none" as const,
          runWorkerFirst: true,
        };
  });
