import { Interaction, layerNonInteractive } from "alchemy/Interaction";
import { Effect, Schema } from "effect";

import { refuse, StateCopyRefused } from "./state-copy.js";

export const credentialRefreshTask =
  "Refreshing Cloudflare State Store credentials";

export const provisioningFence = Effect.gen(function* makeProvisioningFence() {
  const unattended = yield* Interaction.pipe(
    Effect.provide(layerNonInteractive())
  );

  return Interaction.of({
    ...unattended,
    task: (options, effect) =>
      options.label === credentialRefreshTask
        ? unattended.task(options, effect)
        : Effect.die(refuse("provisioning-refused", [], options.label)),
  });
});

const isStateCopyRefused = Schema.is(StateCopyRefused);

export const withProvisioningFence = <A, E, R>(
  effect: Effect.Effect<A, E, R>
) =>
  Effect.gen(function* fenced() {
    const fence = yield* provisioningFence;

    return yield* effect.pipe(Effect.provideService(Interaction, fence));
  }).pipe(
    Effect.catchDefect((defect) =>
      isStateCopyRefused(defect) ? Effect.fail(defect) : Effect.die(defect)
    )
  );
