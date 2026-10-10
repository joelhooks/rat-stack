import { watchActor } from "@rat-stack/capability/actor-watch";
import { createEffectActor, fromEffect, setupEffect } from "@xstate/effect";
import { Context, Effect, Layer, Ref, Schema } from "effect";

export const FlagStage = Schema.Literals(["rollingOut", "on", "removed"]);

export const FlagTransition = Schema.Struct({
  name: Schema.String,
  stage: FlagStage,
});

export class FlagLifecycleJournal extends Context.Service<
  FlagLifecycleJournal,
  {
    readonly record: (
      transition: typeof FlagTransition.Type
    ) => Effect.Effect<void>;
    readonly entries: Effect.Effect<readonly (typeof FlagTransition.Type)[]>;
  }
>()("@rat-stack/flags/FlagLifecycleJournal") {
  static memory = Layer.effect(
    FlagLifecycleJournal,
    Effect.gen(function* makeJournal() {
      const entries = yield* Ref.make<readonly (typeof FlagTransition.Type)[]>(
        []
      );

      return FlagLifecycleJournal.of({
        entries: Ref.get(entries),
        record: (transition) =>
          Ref.update(entries, (current) => [...current, transition]),
      });
    })
  );
}

const recordTransition = fromEffect({
  effect: ({ input }) =>
    FlagLifecycleJournal.use((journal) => journal.record(input)),
  schemas: { input: FlagTransition },
});

export const flagMachine = setupEffect({
  actors: { recordTransition },
  schemas: {
    context: Schema.Struct({ name: Schema.String }),
    events: {
      ENABLE: Schema.Struct({}),
      REMOVE: Schema.Struct({}),
      ROLLOUT: Schema.Struct({}),
    },
    input: Schema.Struct({ name: Schema.String }),
  },
}).createMachine({
  context: ({ input }) => input,
  initial: "declared",
  output: ({ context }) => context.name,
  states: {
    declared: { on: { ROLLOUT: { target: "startingRollout" } } },
    enabling: {
      invoke: {
        input: ({ context }) => ({ name: context.name, stage: "on" }),
        onDone: { target: "on" },
        src: "recordTransition",
      },
    },
    on: { on: { REMOVE: { target: "removing" } } },
    removed: { type: "final" },
    removing: {
      invoke: {
        input: ({ context }) => ({ name: context.name, stage: "removed" }),
        onDone: { target: "removed" },
        src: "recordTransition",
      },
    },
    rollingOut: { on: { ENABLE: { target: "enabling" } } },
    startingRollout: {
      invoke: {
        input: ({ context }) => ({ name: context.name, stage: "rollingOut" }),
        onDone: { target: "rollingOut" },
        src: "recordTransition",
      },
    },
  },
});

export const startFlagLifecycle = Effect.fn("startFlagLifecycle")(
  function* startFlagLifecycle(name: string) {
    const actor = yield* createEffectActor(flagMachine, { input: { name } });
    yield* watchActor("flagMachine", actor);

    return actor;
  }
);
