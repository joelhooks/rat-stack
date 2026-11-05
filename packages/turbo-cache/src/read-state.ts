import * as Cloudflare from "@alchemy.run/cloudflare";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { AuthProvidersLive } from "alchemy/Auth/Registry";
import * as State from "alchemy/State";
import { ConfigProvider, Effect, Layer } from "effect";

import { turboCacheConfig } from "./config.js";

export const withoutStateProvisioning = <A, E, R>(
  effect: Effect.Effect<A, E, R>
) =>
  effect.pipe(
    Effect.updateService(AlchemyContext, (context) => ({
      ...context,
      updateStateStore: false,
    })),
    Effect.updateService(ConfigProvider.ConfigProvider, (fallback) =>
      ConfigProvider.fromUnknown({ CI: true }).pipe(
        ConfigProvider.orElse(fallback)
      )
    )
  );

export const deployedCacheState = withoutStateProvisioning(
  Effect.flatten(State.State).pipe(
    Effect.provide(
      Cloudflare.state({ workerName: turboCacheConfig.stateStoreName }).pipe(
        Layer.provide(AuthProvidersLive)
      )
    )
  )
);
