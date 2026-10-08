import { watchActor } from "@rat-stack/capability/actor-watch";
import {
  createEffectActor,
  fromEffect,
  join,
  setupEffect,
} from "@xstate/effect";
import { Context, Effect, Schema } from "effect";
import { types } from "xstate";

import { BasinProofFailure } from "./basin-proof-failure.js";

export { BasinProofFailure } from "./basin-proof-failure.js";

export const ErasureCountsSchema = Schema.Struct({
  parquetGone: Schema.Natural,
  rowsRemaining: Schema.Natural,
  rowsWritten: Schema.Natural,
  snapshotsExpired: Schema.Natural,
});

export class BasinProof extends Context.Service<
  BasinProof,
  {
    readonly plan: () => Effect.Effect<void, BasinProofFailure>;
    readonly create: () => Effect.Effect<number, BasinProofFailure>;
    readonly prove: () => Effect.Effect<
      typeof ErasureCountsSchema.Type,
      BasinProofFailure
    >;
    readonly destroy: () => Effect.Effect<number, BasinProofFailure>;
  }
>()("@rat-stack/deploy/BasinProof") {}

interface ProofContext {
  readonly created: number;
  readonly destroyed: number;
  readonly counts: typeof ErasureCountsSchema.Type;
  readonly failure: BasinProofFailure | undefined;
}

const plan = fromEffect({
  effect: () => BasinProof.use((proof) => proof.plan()),
});

const create = fromEffect({
  effect: () => BasinProof.use((proof) => proof.create()),
});

const prove = fromEffect({
  effect: () => BasinProof.use((proof) => proof.prove()),
});

const destroy = fromEffect({
  effect: () => BasinProof.use((proof) => proof.destroy()),
});

export const basinProofMachine = setupEffect({
  actors: { create, destroy, plan, prove },
  schemas: { context: types<ProofContext>() },
}).createMachine({
  context: {
    counts: {
      parquetGone: 0,
      rowsRemaining: 0,
      rowsWritten: 0,
      snapshotsExpired: 0,
    },
    created: 0,
    destroyed: 0,
    failure: undefined,
  },
  initial: "planning",
  output: ({ context }) => context,
  states: {
    creating: {
      invoke: {
        onDone: {
          context: ({ context, event }) => ({
            ...context,
            created: event.output,
          }),
          target: "proving",
        },
        onError: {
          context: ({ context, event }) => ({
            ...context,
            created: event.error.completed,
            failure: event.error,
          }),
          target: "destroying",
        },
        src: "create",
      },
    },
    destroying: {
      invoke: {
        onDone: {
          context: ({ context, event }) => ({
            ...context,
            destroyed: event.output,
          }),
          target: "settled",
        },
        onError: {
          context: ({ context, event }) => ({
            ...context,
            destroyed: event.error.completed,
            failure: context.failure ?? event.error,
          }),
          target: "settled",
        },
        src: "destroy",
      },
    },
    planning: {
      invoke: {
        onDone: { target: "creating" },
        onError: {
          context: ({ context, event }) => ({
            ...context,
            failure: event.error,
          }),
          target: "settled",
        },
        src: "plan",
      },
    },
    proving: {
      invoke: {
        onDone: {
          context: ({ context, event }) => ({
            ...context,
            counts: event.output,
            failure:
              event.output.rowsWritten === 3 &&
              event.output.rowsRemaining === 1 &&
              event.output.snapshotsExpired > 0 &&
              event.output.parquetGone > 0
                ? undefined
                : new BasinProofFailure({
                    completed: 0,
                    reason: "engine-failed",
                  }),
          }),
          target: "destroying",
        },
        onError: {
          context: ({ context, event }) => ({
            ...context,
            failure: event.error,
          }),
          target: "destroying",
        },
        src: "prove",
      },
    },
    settled: { type: "final" },
  },
});

export const runBasinProof = Effect.gen(function* runBasinProof() {
  const actor = yield* createEffectActor(basinProofMachine);
  yield* watchActor("basinProofMachine", actor);

  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- typed operation failures settle in context; unknown machine failures remain defects.
  return yield* join(actor).pipe(Effect.orDie);
}).pipe(Effect.scoped);
