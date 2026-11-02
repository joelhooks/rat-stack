import { NodeSocket } from "@effect/platform-node";
import * as AlchemistState from "alchemy/Alchemist/routes/state";
import type { StateService } from "alchemy/State/State";
import { Context, Effect, Layer } from "effect";
import type { Scope } from "effect";

import { defaultStateStoreName, refuse } from "./state-copy.js";
import type { StateCopyRefused } from "./state-copy.js";

export interface StateStoreAddress {
  readonly name: string | undefined;
  readonly profile: string;
}

export class StateStores extends Context.Service<
  StateStores,
  {
    readonly open: (
      address: StateStoreAddress
    ) => Effect.Effect<StateService, StateCopyRefused, Scope.Scope>;
  }
>()("@rat-stack/deploy/StateStores") {}

export const storeAddress = (
  store: string,
  profile: string
): StateStoreAddress => ({
  name: store === defaultStateStoreName ? undefined : store,
  profile,
});

const providerSource = (
  envFile: string,
  address: StateStoreAddress
): AlchemistState.ProviderSource => {
  const source = {
    // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- Alchemy's StateSource is a plain tagged union with no constructor.
    _tag: "Provider",
    backend: "cloudflare",
    envFile,
    profile: address.profile,
  } as const;

  return address.name === undefined
    ? source
    : { ...source, name: address.name };
};

export const stateStoresLayer = (envFile: string) =>
  Layer.effect(
    StateStores,
    Effect.gen(function* makeStateStores() {
      const context =
        yield* Effect.context<
          Exclude<
            Effect.Services<ReturnType<typeof AlchemistState.store>>,
            Scope.Scope
          >
        >();

      return {
        open: (address) =>
          // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Alchemy builds the provider's state layer from erased contributions; this adapter maps the unknown failure into StateCopyRefused.
          AlchemistState.store(providerSource(envFile, address)).pipe(
            Effect.provideContext(context),
            Effect.mapError((failure) =>
              refuse("store-unavailable", [], String(failure))
            )
          ),
      };
    })
  ).pipe(Layer.provide(NodeSocket.layerWebSocketConstructor));
