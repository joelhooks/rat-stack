import { NodeSocket } from "@effect/platform-node";
import * as Alchemist from "alchemy/Alchemist";
import type { StateService } from "alchemy/State/State";
import { Context, Effect, Layer } from "effect";
import type { Scope } from "effect";

import { withProvisioningFence } from "./provisioning-fence.js";
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
  address: StateStoreAddress
): Alchemist.State.ProviderSource => {
  const source = {
    backend: "cloudflare",
    profile: address.profile,
    type: "provider",
  } as const;

  return address.name === undefined
    ? source
    : { ...source, name: address.name };
};

export const stateStoresLayer = () =>
  Layer.effect(
    StateStores,
    Effect.gen(function* makeStateStores() {
      const context =
        yield* Effect.context<
          Exclude<
            Effect.Services<ReturnType<typeof Alchemist.State.store>>,
            Scope.Scope
          >
        >();

      return {
        open: (address) =>
          Alchemist.State.store(providerSource(address)).pipe(
            Effect.mapError((failure) =>
              refuse("store-unavailable", [], failure.message)
            ),
            withProvisioningFence,
            Effect.provideContext(context)
          ),
      };
    })
  ).pipe(Layer.provide(NodeSocket.layerWebSocketConstructor));
