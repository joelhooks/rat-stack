import { watchActor } from "@rat-stack/capability/actor-watch";
import { defineContract } from "@rat-stack/capability/contract";
import { implement } from "@rat-stack/capability/implement";
import {
  createEffectActor,
  fromEffect,
  join,
  setupEffect,
} from "@xstate/effect";
import { Effect, Result, Schema } from "effect";
import { types } from "xstate";

import {
  RollbackInputSchema,
  RollbackReceiptSchema,
  RollbackSourceSchema,
} from "./rollback-contracts.js";
import type {
  RollbackInput,
  RollbackReceipt,
  RollbackSource,
} from "./rollback-contracts.js";
import { RollbackFailed } from "./rollback-failed.js";
import { RollbackRefused } from "./rollback-refused.js";
import { RollbackRunner } from "./rollback-runner.js";

interface RollbackContext {
  readonly failure?: RollbackRefused | RollbackFailed;
  readonly input: RollbackInput;
  readonly receipt?: RollbackReceipt;
  readonly source?: RollbackSource;
}

const load = fromEffect({
  effect: ({ input }) =>
    RollbackRunner.use((runner) => runner.load(input)).pipe(Effect.result),
  schemas: { input: RollbackInputSchema },
});

const restore = fromEffect({
  effect: ({ input }) =>
    input === undefined
      ? Effect.die("rollback-source-missing")
      : RollbackRunner.use((runner) => runner.restore(input)).pipe(
          Effect.result
        ),
  schemas: { input: Schema.UndefinedOr(RollbackSourceSchema) },
});

const check = fromEffect({
  effect: ({ input }) =>
    input === undefined
      ? Effect.die("rollback-receipt-missing")
      : RollbackRunner.use((runner) => runner.check(input)).pipe(Effect.result),
  schemas: { input: Schema.UndefinedOr(RollbackReceiptSchema) },
});

const record = fromEffect({
  effect: ({ input }) =>
    input === undefined
      ? Effect.die("rollback-receipt-missing")
      : RollbackRunner.use((runner) => runner.record(input)).pipe(
          Effect.result
        ),
  schemas: { input: Schema.UndefinedOr(RollbackReceiptSchema) },
});

export const rollbackMachine = setupEffect({
  actors: { check, load, record, restore },
  schemas: { context: types<RollbackContext>(), input: RollbackInputSchema },
}).createMachine({
  context: ({ input }) => ({ input }),
  initial: "loading",
  output: ({ context }) => context,
  states: {
    checking: {
      invoke: {
        input: ({ context }) => context.receipt,
        onDone: ({ event }) =>
          Result.isSuccess(event.output)
            ? {
                context: { receipt: event.output.success },
                target: "recording",
              }
            : { context: { failure: event.output.failure }, target: "failed" },
        src: "check",
      },
    },
    done: { type: "final" },
    failed: { type: "final" },
    loading: {
      invoke: {
        input: ({ context }) => context.input,
        onDone: ({ event }) =>
          Result.isSuccess(event.output)
            ? { context: { source: event.output.success }, target: "restoring" }
            : { context: { failure: event.output.failure }, target: "refused" },
        src: "load",
      },
    },
    recording: {
      invoke: {
        input: ({ context }) => context.receipt,
        onDone: ({ event }) =>
          Result.isSuccess(event.output)
            ? { context: { receipt: event.output.success }, target: "done" }
            : { context: { failure: event.output.failure }, target: "failed" },
        src: "record",
      },
    },
    refused: { type: "final" },
    restoring: {
      invoke: {
        input: ({ context }) => context.source,
        onDone: ({ event }) =>
          Result.isSuccess(event.output)
            ? { context: { receipt: event.output.success }, target: "checking" }
            : { context: { failure: event.output.failure }, target: "failed" },
        src: "restore",
      },
    },
  },
});

export const runRollback = Effect.fn("runRollback")(function* runRollback(
  input: RollbackInput
) {
  const actor = yield* createEffectActor(rollbackMachine, { input });
  yield* watchActor("rollbackMachine", actor);
  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Unexpected recovery machine failures remain defects and never establish health.
  const outcome = yield* join(actor).pipe(Effect.orDie);

  if (outcome.failure !== undefined) {
    return yield* outcome.failure;
  }

  if (outcome.receipt === undefined) {
    return yield* Effect.die("rollback-completed-without-receipt");
  }

  if (outcome.receipt.outcome !== "healthy") {
    return yield* new RollbackFailed({ receipt: outcome.receipt });
  }

  return outcome.receipt;
}, Effect.scoped);

export const deployRollbackContract = defineContract("deployRollback", {
  annotations: { destructive: true, idempotent: true, readOnly: false },
  description:
    "Restore prior Worker versions from an apply receipt, then qualify and record recovery",
  failure: Schema.Union([RollbackRefused, RollbackFailed]),
  input: RollbackInputSchema,
  needsApproval: true,
  output: RollbackReceiptSchema,
});

export const deployRollback = implement(deployRollbackContract, runRollback);
