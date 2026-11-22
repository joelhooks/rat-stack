import { AssetReadError } from "@rat-stack/core/contracts";
import { SetupHelpGuide } from "@rat-stack/core/tokenmaxx-help";
import { GuideTable } from "@rat-stack/core/tokenmaxx-help-guide";
import type { GuideRow } from "@rat-stack/core/tokenmaxx-help-guide";
import { Effect, Layer, Option, Ref, Schema } from "effect";

import { staticAssetGeneration } from "../bundled-content.generated.js";
import { StaticAssets } from "../static-assets.js";

export const HELP_GUIDE_ASSET = "/_content/tokenmaxx-help.json";

const Envelope = Schema.fromJsonString(
  Schema.Struct({ data: GuideTable, generation: Schema.String })
);

export const helpGuideForGeneration = (generation: string) =>
  Layer.effect(
    SetupHelpGuide,
    Effect.gen(function* makeHelpGuide() {
      const assets = yield* StaticAssets;

      const completed = yield* Ref.make<
        Option.Option<readonly (typeof GuideRow.Type)[]>
      >(Option.none());

      const rows = Effect.gen(function* readGuide() {
        const cached = yield* Ref.get(completed);

        if (Option.isSome(cached)) {
          return cached.value;
        }

        const bytes = yield* assets.read(HELP_GUIDE_ASSET);

        const envelope = yield* Schema.decodeEffect(Envelope)(
          new TextDecoder().decode(bytes)
        ).pipe(
          Effect.mapError(
            (cause) =>
              new AssetReadError({
                cause,
                path: HELP_GUIDE_ASSET,
                reason: "decode",
              })
          )
        );

        if (envelope.generation !== generation) {
          return yield* new AssetReadError({
            cause: envelope.generation,
            path: HELP_GUIDE_ASSET,
            reason: "generation",
          });
        }

        yield* Ref.set(completed, Option.some(envelope.data.rows));

        return envelope.data.rows;
      });

      return SetupHelpGuide.of({ rows });
    })
  );

export const helpGuideLayer = helpGuideForGeneration(staticAssetGeneration);
