import { watchActor } from "@rat-stack/capability/actor-watch";
import { ApprovalDenied } from "@rat-stack/capability/approval";
import type { Around } from "@rat-stack/capability/call-watch";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import { Cause, Clock, Crypto, Effect, Exit, Option, Schema } from "effect";
import { types } from "xstate";

import {
  FlagActor,
  CompletedFlagChangeSchema,
  FlagJournal,
  FlagPreviousValue,
} from "./flag-control.js";
import type { PendingFlagChange, CompletedFlagChange } from "./flag-control.js";
import { FlagStorageError } from "./flag-storage-error.js";
import { Flags, InvalidFlagValue } from "./flags.js";

const FlagAttemptInput = Schema.Struct({
  name: Schema.String,
  scope: Schema.optionalKey(Schema.Json),
});

type FlagAttempt = typeof FlagAttemptInput.Type & {
  readonly value: Schema.Json;
};

const prepareAttempt = Effect.fn("prepareFlagAttempt")(function* prepareAttempt(
  input: FlagAttempt
) {
  const flags = yield* Flags;
  const journal = yield* FlagJournal;
  const flag = flags.registry.find((entry) => entry.name === input.name);

  const observed =
    flag === undefined
      ? Effect.succeed(
          FlagPreviousValue.cases.Unavailable.make({ reason: "UnknownFlag" })
        )
      : flags.get(flag, { scope: input.scope ?? "global" }).pipe(
          Effect.flatMap((value) => Schema.encodeEffect(flag.schema)(value)),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
          Effect.map((value) => FlagPreviousValue.cases.Known.make({ value })),
          Effect.orElseSucceed(() =>
            FlagPreviousValue.cases.Unavailable.make({
              reason: "FlagReadFailed",
            })
          )
        );

  const recordedAt = yield* Clock.currentTimeMillis;
  const crypto = yield* Crypto.Crypto;

  const random = yield* crypto.randomUUIDv7().pipe(
    Effect.mapError(
      (cause) =>
        new FlagStorageError({
          cause,
          fallback: null,
          flag: input.name,
          operation: "audit",
          repair:
            "Restore the cryptographic attempt-id service before retrying this write.",
        })
    )
  );

  const change: PendingFlagChange = {
    actor: yield* FlagActor,
    attemptId: `${String(recordedAt).padStart(16, "0")}-${random}`,
    name: input.name,
    newValue: input.value,
    oldValue: yield* observed,
    outcome: "Pending",
    recordedAt,
    scope: input.scope ?? "global",
  };

  yield* journal.record(change);

  return change;
});

const terminalOutcome = <A, E>(
  exit: Exit.Exit<A, E>
): CompletedFlagChange["outcome"] => {
  if (Exit.isSuccess(exit)) {
    return "Succeeded";
  }

  if (Cause.hasInterrupts(exit.cause)) {
    return "Interrupted";
  }

  return Option.exists(
    Cause.findErrorOption(exit.cause),
    Schema.is(ApprovalDenied)
  )
    ? "Denied"
    : "Failed";
};

interface AttemptContext<A, E> {
  readonly change: PendingFlagChange | undefined;
  readonly result: Exit.Exit<A, E | FlagStorageError> | undefined;
}

const observeRun = <A, E, R>(input: FlagAttempt, run: Effect.Effect<A, E, R>) =>
  Effect.gen(function* runFlagAttemptMachine() {
    const prepare = createEffectLogic(prepareAttempt(input).pipe(Effect.exit));
    const execute = createEffectLogic(run.pipe(Effect.exit));

    const complete = createEffectLogic({
      effect: ({ input: change }) =>
        Effect.gen(function* completeAttempt() {
          const journal = yield* FlagJournal;
          const recordedAt = yield* Clock.currentTimeMillis;

          yield* journal.record({ ...change, recordedAt });
        }).pipe(Effect.exit),
      schemas: { input: CompletedFlagChangeSchema },
    });

    const machine = setupEffect({
      actors: { complete, execute, prepare },
      schemas: { context: types<AttemptContext<A, E>>() },
    }).createMachine({
      context: { change: undefined, result: undefined },
      initial: "recordingPending",
      output: ({ context }) => context.result,
      states: {
        auditUnavailable: { type: "final" },
        completed: { type: "final" },
        executing: {
          invoke: {
            onDone: {
              context: ({ event }) => ({ result: event.output }),
              target: "recordingOutcome",
            },
            src: "execute",
          },
        },
        recordingOutcome: {
          invoke: {
            input: ({ context }) => {
              if (
                context.change === undefined ||
                context.result === undefined
              ) {
                throw new Error(
                  "Flag audit reached completion without its attempt and result."
                );
              }

              return {
                ...context.change,
                outcome: terminalOutcome(context.result),
              };
            },
            onDone: ({ event }) =>
              Exit.isSuccess(event.output)
                ? { target: "completed" }
                : {
                    context: { result: Exit.failCause(event.output.cause) },
                    target: "auditUnavailable",
                  },
            src: "complete",
          },
        },
        recordingPending: {
          invoke: {
            onDone: ({ event }) =>
              Exit.isSuccess(event.output)
                ? {
                    context: { change: event.output.value },
                    target: "executing",
                  }
                : {
                    context: { result: Exit.failCause(event.output.cause) },
                    target: "auditUnavailable",
                  },
            src: "prepare",
          },
        },
      },
    });

    const actor = yield* createEffectActor(machine);
    yield* watchActor("flagAttemptMachine", actor);
    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Expected failures travel in Exit output; an unexpected machine failure is a defect.
    const result = yield* join(actor).pipe(Effect.orDie);

    if (result === undefined) {
      return yield* Effect.die(
        new Error("Flag attempt completed without a result.")
      );
    }

    return yield* result;
  }).pipe(Effect.scoped);

export const auditFlagRun: Around<
  FlagStorageError | InvalidFlagValue,
  Flags | FlagJournal | Crypto.Crypto
> = (_contract, input, run) =>
  Effect.all({
    parsed: Schema.decodeUnknownEffect(FlagAttemptInput)(input),
    value: Schema.decodeUnknownEffect(Schema.Json)(input),
  }).pipe(
    Effect.mapError(
      () =>
        new InvalidFlagValue({
          flag: "flag attempt",
          repair: "Supply a declared name and a JSON value.",
        })
    ),
    Effect.flatMap(({ parsed, value }) => observeRun({ ...parsed, value }, run))
  );
