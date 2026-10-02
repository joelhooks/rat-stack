import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";
import { Arbitrary } from "effect/unstable/arbitrary";

import { emitAssets } from "../scripts/emit-assets.ts";
import { assetDirectoryForBuild } from "../src/asset-deployment.js";

it.effect.prop(
  "refuses a manifest from a different build before uploading",
  { fragment: Arbitrary.schema(Schema.String) },
  ({ fragment }) =>
    Effect.gen(function* mismatchedBuild() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();

      const originalPage = {
        documentHtml: `${fragment} original`,
        routePath: "/",
        text: "markdown",
      };

      const input = {
        directory,
        images: [{ base64: "aW1hZ2U=", path: "/image.png" }],
        pages: [originalPage],
      };

      const first = yield* emitAssets(input);

      const current = yield* emitAssets({
        ...input,
        pages: [{ ...originalPage, documentHtml: `${fragment} changed` }],
      });

      const runtime = {
        generation: first.generation,
        images: ["/image.png"],
        pages: ["/"],
      };

      const rejected = yield* assetDirectoryForBuild(directory, runtime).pipe(
        Effect.flip
      );

      expect(rejected._tag).toBe("AssetDeploymentError");
      expect(rejected.reason).toBe("generation");
      expect(rejected.cause).toBe(current.generation);

      const selected = yield* assetDirectoryForBuild(directory, {
        ...runtime,
        generation: current.generation,
      });

      expect(selected).toBe(path.join(directory, "assets", current.generation));
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "refuses route, image and file drift even with a matching generation",
  () =>
    Effect.gen(function* incompleteUpload() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped();

      const input = {
        directory,
        images: [{ base64: "aW1hZ2U=", path: "/image.png" }],
        pages: [{ documentHtml: "html", routePath: "/", text: "markdown" }],
      };

      const manifest = yield* emitAssets(input);

      const runtime = {
        generation: manifest.generation,
        images: ["/image.png"],
        pages: ["/"],
      };

      const assets = path.join(directory, "assets", manifest.generation);

      const routeDrift = yield* assetDirectoryForBuild(directory, {
        ...runtime,
        pages: ["/renamed"],
      }).pipe(Effect.flip);

      expect(routeDrift.reason).toBe("routes");

      const imageDrift = yield* assetDirectoryForBuild(directory, {
        ...runtime,
        images: ["/renamed.png"],
      }).pipe(Effect.flip);

      expect(imageDrift.reason).toBe("images");
      yield* fs.remove(path.join(assets, "index.html"));

      const fileDrift = yield* assetDirectoryForBuild(directory, runtime).pipe(
        Effect.flip
      );

      expect(fileDrift.reason).toBe("file");
      expect(fileDrift.path).toBe(path.join(assets, "index.html"));
      yield* fs.writeFileString(path.join(assets, "index.html"), "");

      const emptyFile = yield* assetDirectoryForBuild(directory, runtime).pipe(
        Effect.flip
      );

      expect(emptyFile.reason).toBe("file");
      yield* fs.remove(assets, { recursive: true });

      const missingDirectory = yield* assetDirectoryForBuild(
        directory,
        runtime
      ).pipe(Effect.flip);

      expect(missingDirectory.reason).toBe("directory");
    }).pipe(Effect.provide(NodeServices.layer))
);
