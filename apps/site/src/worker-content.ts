import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer, Option, Schema } from "effect";

import { AssetBindingSchema, StaticAssets } from "./static-assets.js";

export const workerAssetsLayer = Layer.effect(
  StaticAssets,
  Effect.gen(function* workerAssets() {
    const environment = yield* Cloudflare.WorkerEnvironment;

    const binding = Schema.decodeUnknownOption(AssetBindingSchema)(
      environment.ASSETS
    );

    return Option.isSome(binding)
      ? yield* StaticAssets.pipe(
          Effect.provide(StaticAssets.layer(binding.value))
        )
      : StaticAssets.unavailable;
  })
);
