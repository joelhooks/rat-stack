import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Context, Effect, FileSystem, Layer, Path, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { contentAssetGeneration, emitAssets } from "../scripts/emit-assets.ts";
import { assetDirectoryForBuild } from "../src/asset-deployment.js";
import type { ContentAssetManifest } from "../src/asset-manifest.js";

const buildIdBytes = Schema.Uint8Array.check(
  Schema.isMinLength(32),
  Schema.isMaxLength(32)
);

const assetPage = {
  documentHtml: "original",
  routePath: "/",
  text: "markdown",
};

const assetContent = {
  images: [{ base64: "aW1hZ2U=", path: "/image.png" }],
  pages: [assetPage],
};

class AssetCorpus extends Context.Service<
  AssetCorpus,
  {
    readonly directory: string;
    readonly generation: Ref.Ref<string>;
    readonly manifest: typeof ContentAssetManifest.Type;
  }
>()("test/AssetCorpus") {
  static layer = Layer.effect(
    this,
    Effect.gen(function* assetCorpus() {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const manifest = yield* emitAssets({ ...assetContent, directory });

      return {
        directory,
        generation: yield* Ref.make(manifest.generation),
        manifest,
      };
    })
  );
}

it.prop(
  "HTML content contributes to generation identity",
  { fragment: Arbitrary.schema(Schema.String) },
  ({ fragment }) => {
    const original = {
      ...assetContent,
      pages: [{ ...assetPage, documentHtml: `${fragment} original` }],
    };

    const changed = {
      ...assetContent,
      pages: [{ ...assetPage, documentHtml: `${fragment} changed` }],
    };

    expect(contentAssetGeneration(original)).not.toBe(
      contentAssetGeneration(changed)
    );
  }
);

it.layer(NodeServices.layer)((nodeIt) => {
  nodeIt.layer(AssetCorpus.layer)((corpusIt) => {
    corpusIt.effect.prop(
      "selects the matching manifest and refuses every other generation",
      {
        generation: Arbitrary.schema(buildIdBytes),
        other: Arbitrary.schema(buildIdBytes),
      },
      ({ generation: generationBytes, other: otherBytes }) =>
        Effect.gen(function* selectGeneratedManifest() {
          const generation = Buffer.from(generationBytes).toString("hex");
          const other = Buffer.from(otherBytes).toString("hex");
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const corpus = yield* AssetCorpus;
          const previous = yield* Ref.get(corpus.generation);
          yield* fs.rename(
            path.join(corpus.directory, "assets", previous),
            path.join(corpus.directory, "assets", generation)
          );
          yield* Ref.set(corpus.generation, generation);
          yield* fs.writeFileString(
            path.join(corpus.directory, "manifest.json"),
            JSON.stringify({ ...corpus.manifest, generation })
          );

          const different =
            other === generation
              ? other.replace(/^./u, (digit) => (digit === "0" ? "1" : "0"))
              : other;

          const runtime = {
            generation: different,
            images: ["/image.png"],
            pages: ["/"],
          };

          const rejected = yield* assetDirectoryForBuild(
            corpus.directory,
            runtime
          ).pipe(Effect.flip);

          expect(rejected._tag).toBe("AssetDeploymentError");
          expect(rejected.reason).toBe("generation");
          expect(rejected.cause).toBe(generation);

          const selected = yield* assetDirectoryForBuild(corpus.directory, {
            ...runtime,
            generation,
          });

          expect(selected).toBe(
            path.join(corpus.directory, "assets", generation)
          );
        })
    );
  });

  nodeIt.effect(
    "refuses a manifest from a different real build before uploading",
    () =>
      Effect.gen(function* mismatchedBuild() {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped();
        const input = { ...assetContent, directory };
        const first = yield* emitAssets(input);

        const current = yield* emitAssets({
          ...input,
          pages: [{ ...assetPage, documentHtml: "changed" }],
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

        expect(selected).toBe(
          path.join(directory, "assets", current.generation)
        );
      })
  );

  nodeIt.effect(
    "refuses route, image and file drift even with a matching generation",
    () =>
      Effect.gen(function* incompleteUpload() {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped();
        const input = { ...assetContent, directory };
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

        const fileDrift = yield* assetDirectoryForBuild(
          directory,
          runtime
        ).pipe(Effect.flip);

        expect(fileDrift.reason).toBe("file");
        expect(fileDrift.path).toBe(path.join(assets, "index.html"));
        yield* fs.writeFileString(path.join(assets, "index.html"), "");

        const emptyFile = yield* assetDirectoryForBuild(
          directory,
          runtime
        ).pipe(Effect.flip);

        expect(emptyFile.reason).toBe("file");
        yield* fs.remove(assets, { recursive: true });

        const missingDirectory = yield* assetDirectoryForBuild(
          directory,
          runtime
        ).pipe(Effect.flip);

        expect(missingDirectory.reason).toBe("directory");
      })
  );
});
