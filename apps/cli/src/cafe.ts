import { CafeDirectory } from "@rat-stack/core";
import { AssetReadError, CafeData } from "@rat-stack/core/contracts";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";

export const localCafeDirectoryLayer = Layer.effect(
  CafeDirectory,
  Effect.gen(function* makeLocalCafeDirectory() {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const directory = paths.join(process.cwd(), "apps/mischief/dist/content");
    const manifestPath = paths.join(directory, "manifest.json");

    const data = fs.readFileString(manifestPath).pipe(
      Effect.flatMap(
        Schema.decodeEffect(
          Schema.fromJsonString(
            Schema.Struct({
              generation: Schema.String.check(
                Schema.isPattern(/^[0-9a-f]{64}$/u)
              ),
            })
          )
        )
      ),
      Effect.mapError(
        (cause) =>
          new AssetReadError({ cause, path: manifestPath, reason: "provider" })
      ),
      Effect.flatMap(({ generation }) => {
        const path = paths.join(
          directory,
          "assets",
          generation,
          "_content/cafe.json"
        );

        return fs.readFileString(path).pipe(
          Effect.flatMap(
            Schema.decodeEffect(
              Schema.fromJsonString(
                Schema.Struct({ data: CafeData, generation: Schema.String })
              )
            )
          ),
          Effect.mapError(
            (cause) => new AssetReadError({ cause, path, reason: "provider" })
          ),
          Effect.filterOrFail(
            (envelope) => envelope.generation === generation,
            () =>
              new AssetReadError({
                cause: "CAFE data generation differs from manifest",
                path,
                reason: "generation",
              })
          ),
          Effect.map((envelope) => envelope.data)
        );
      })
    );

    return CafeDirectory.of({ data });
  })
);
