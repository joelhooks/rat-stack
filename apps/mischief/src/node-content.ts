import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path } from "effect";

import { assetDirectoryForBuild } from "./asset-deployment.js";
import { staticAssetGeneration } from "./bundled-content.generated.js";
import { ContentStore } from "./content-store.js";
import { AssetReadError } from "./static-assets-error.js";
import { StaticAssets } from "./static-assets.js";

export const nodeAssetsForGeneration = (
  directory: string,
  generation: string
) =>
  Layer.effect(
    StaticAssets,
    Effect.gen(function* nodeAssets() {
      const fs = yield* FileSystem.FileSystem;
      const paths = yield* Path.Path;

      const assetsDirectory = yield* assetDirectoryForBuild(directory, {
        generation,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new AssetReadError({
              cause,
              path: "/manifest.json",
              reason: "generation",
            })
        )
      );

      return StaticAssets.of({
        read: (path) =>
          fs.readFile(paths.join(assetsDirectory, path.slice(1))).pipe(
            Effect.mapError(
              (cause) => new AssetReadError({ cause, path, reason: "provider" })
            ),
            Effect.flatMap((bytes) =>
              bytes.byteLength === 0
                ? Effect.fail(
                    new AssetReadError({
                      cause: "Asset body is empty",
                      path,
                      reason: "empty",
                    })
                  )
                : Effect.succeed(bytes)
            )
          ),
      });
    })
  ).pipe(Layer.provide(NodeServices.layer));

export const nodeAssetsLayer = nodeAssetsForGeneration(
  new URL("../dist/content", import.meta.url).pathname,
  staticAssetGeneration
);

export const nodeContentLayer = ContentStore.layer.pipe(
  Layer.provide(nodeAssetsLayer)
);
