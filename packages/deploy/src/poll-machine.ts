import { watchActor } from "@rat-stack/capability/actor-watch";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import { Clock, Effect, Schema } from "effect";
import { types } from "xstate";

export interface PollOptions {
  readonly deadlineMs: number;
  readonly initialDelayMs: number;
  readonly maximumDelayMs: number;
}

export interface PollObservation<A> {
  readonly observation: A;
  readonly observedAt: number;
}

export interface PollResult<A> {
  readonly attempts: readonly PollObservation<A>[];
  readonly elapsedMs: number;
  readonly stoppedBy: "deadline" | "settled";
}

const PollInput = Schema.Struct({
  deadlineMs: Schema.Finite,
  initialDelayMs: Schema.Finite,
  maximumDelayMs: Schema.Finite,
  startedAt: Schema.Finite,
});

type PollContext<A> = typeof PollInput.Type & {
  readonly attempts: readonly PollObservation<A>[];
  readonly delayMs: number;
  readonly elapsedMs: number;
  readonly stoppedBy: "deadline" | "settled";
};

const PollWaitInput = Schema.Struct({ delayMs: Schema.Finite });

const exponentialCap = 20;

export const backoffDelayMs = (
  options: PollOptions,
  attempts: number,
  elapsedMs: number
) =>
  Math.min(
    options.maximumDelayMs,
    options.initialDelayMs * 2 ** Math.min(attempts - 1, exponentialCap),
    options.deadlineMs - elapsedMs
  );

export const pollMachine = <A, R>(
  observe: (remainingMs: number) => Effect.Effect<
    {
      readonly observation: A;
      readonly settled: boolean;
    },
    never,
    R
  >
) => {
  const attempt = createEffectLogic({
    effect: ({ input }) =>
      Effect.gen(function* observeOnce() {
        const remainingMs = Math.max(
          0,
          input.deadlineMs -
            ((yield* Clock.currentTimeMillis) - input.startedAt)
        );

        const result = yield* observe(remainingMs);
        const observedAt = yield* Clock.currentTimeMillis;

        return {
          ...result,
          elapsedMs: observedAt - input.startedAt,
          observedAt,
        };
      }),
    schemas: { input: PollInput },
  });

  const wait = createEffectLogic({
    effect: ({ input }) => Effect.sleep(input.delayMs),
    schemas: { input: PollWaitInput },
  });

  return setupEffect({
    actors: { attempt, wait },
    schemas: {
      context: types<PollContext<A>>(),
      input: PollInput,
    },
  }).createMachine({
    context: ({ input }) => ({
      ...input,
      attempts: [],
      delayMs: 0,
      elapsedMs: 0,
      stoppedBy: "deadline",
    }),
    initial: "attempting",
    output: ({ context }): PollResult<A> => ({
      attempts: context.attempts,
      elapsedMs: context.elapsedMs,
      stoppedBy: context.stoppedBy,
    }),
    states: {
      attempting: {
        invoke: {
          input: ({ context }) => ({
            deadlineMs: context.deadlineMs,
            initialDelayMs: context.initialDelayMs,
            maximumDelayMs: context.maximumDelayMs,
            startedAt: context.startedAt,
          }),
          onDone: ({ context, event }) => {
            const attempts = [
              ...context.attempts,
              {
                observation: event.output.observation,
                observedAt: event.output.observedAt,
              },
            ];

            const { elapsedMs } = event.output;

            if (event.output.settled) {
              return {
                context: { attempts, elapsedMs, stoppedBy: "settled" as const },
                target: "settled",
              };
            }

            if (elapsedMs >= context.deadlineMs) {
              return {
                context: {
                  attempts,
                  elapsedMs,
                  stoppedBy: "deadline" as const,
                },
                target: "deadlineReached",
              };
            }

            return {
              context: {
                attempts,
                delayMs: backoffDelayMs(context, attempts.length, elapsedMs),
                elapsedMs,
              },
              target: "waiting",
            };
          },
          src: "attempt",
        },
      },
      deadlineReached: { type: "final" },
      settled: { type: "final" },
      waiting: {
        invoke: {
          input: ({ context }) => ({ delayMs: context.delayMs }),
          onDone: { target: "attempting" },
          src: "wait",
        },
      },
    },
  });
};

export const runPoll = Effect.fn("runPoll")(function* runPoll<A, R>(
  observe: (remainingMs: number) => Effect.Effect<
    {
      readonly observation: A;
      readonly settled: boolean;
    },
    never,
    R
  >,
  options: PollOptions
) {
  const startedAt = yield* Clock.currentTimeMillis;

  const actor = yield* createEffectActor(pollMachine(observe), {
    input: { ...options, startedAt },
  });

  yield* watchActor("pollMachine", actor);
  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- The observation actor cannot fail; a machine-level error or an early stop is a programming error and orDie closes the unknown ErrorFrom (statelyai/xstate#5725).
  const result = yield* join(actor).pipe(Effect.orDie);

  if (result === undefined) {
    return yield* Effect.die(new Error("pollMachine completed without output"));
  }

  return result;
}, Effect.scoped);
