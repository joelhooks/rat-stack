import { WorkshopPublicData } from "@rat-stack/core/tokenmaxx-workshop";
import { WorkshopDirectory } from "@rat-stack/core/workshop-directory";
import { Effect, Layer, Option, Ref, Schema } from "effect";

import { staticAssetGeneration } from "./bundled-content.generated.js";
import { AssetReadError } from "./static-assets-error.js";
import { StaticAssets } from "./static-assets.js";
import { workshopAssets } from "./workshop-assets.js";

const [workshopPath] = workshopAssets.data;

export const workshopDirectoryForGeneration = (generation: string) =>
  Layer.effect(
    WorkshopDirectory,
    Effect.gen(function* makeWorkshopDirectory() {
      const assets = yield* StaticAssets;

      const completed = yield* Ref.make<
        Option.Option<typeof WorkshopPublicData.Type>
      >(Option.none());

      const data = Effect.gen(function* readWorkshop() {
        const cached = yield* Ref.get(completed);

        if (Option.isSome(cached)) {
          return cached.value;
        }

        const bytes = yield* assets.read(workshopPath);

        const envelope = yield* Schema.decodeEffect(
          Schema.fromJsonString(
            Schema.Struct({
              data: WorkshopPublicData,
              generation: Schema.String,
            })
          )
        )(new TextDecoder().decode(bytes)).pipe(
          Effect.mapError(
            (cause) =>
              new AssetReadError({
                cause,
                path: workshopPath,
                reason: "decode",
              })
          )
        );

        if (envelope.generation !== generation) {
          return yield* new AssetReadError({
            cause: envelope.generation,
            path: workshopPath,
            reason: "generation",
          });
        }

        yield* Ref.set(completed, Option.some(envelope.data));

        return envelope.data;
      });

      return WorkshopDirectory.of({ data });
    })
  );

export const workshopDirectoryLayer = workshopDirectoryForGeneration(
  staticAssetGeneration
);
