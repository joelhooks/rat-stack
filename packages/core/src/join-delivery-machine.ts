import { watchActor } from "@rat-stack/capability/actor-watch";
import {
  createEffectActor,
  createEffectLogic,
  join,
  setupEffect,
} from "@xstate/effect";
import { Clock, Context, Duration, Effect, Option, Schema } from "effect";
import { types } from "xstate";

import { SubscriberIntake } from "./interest-intake.js";
import type { IntakeResult } from "./interest-intake.js";
import { JoinContactStore } from "./join-contact-store.js";

export const JoinDeliveryDeadline = Context.Reference<Duration.Duration>(
  "@rat-stack/core/JoinDeliveryDeadline",
  { defaultValue: () => Duration.seconds(25) }
);

const MAX_DELIVERY_RETRIES = 2;

const MAX_DELIVERY_WAIT_SECONDS = 3;

interface DeliveryInput {
  readonly submissionId: string;
}

const AttemptInputSchema = Schema.Struct({
  deadlineAt: Schema.Finite,
  submissionId: Schema.String,
});

interface DeliveryContext {
  readonly attempts: number;
  readonly deadlineAt: number;
  readonly result: IntakeResult;
  readonly submissionId: string;
}

const outOfTime = { afterSeconds: 0, kind: "retry" } as const;

export const deliveryStateFor = {
  accepted: "accepted",
  refused: "refused",
  retry: "ready",
} as const satisfies Record<IntakeResult["kind"], string>;

const attempt = Effect.fnUntraced(function* attempt(
  input: typeof AttemptInputSchema.Type
) {
  const contacts = yield* JoinContactStore;
  const intake = yield* SubscriberIntake;
  const contact = yield* contacts.read(input.submissionId);

  if (
    contact === undefined ||
    contact.state === "held" ||
    contact.hold ||
    contact.pending === "erase" ||
    intake.agent === undefined
  ) {
    return { kind: "refused" } as const;
  }

  const remaining = input.deadlineAt - (yield* Clock.currentTimeMillis);

  if (remaining <= 0) {
    return outOfTime;
  }

  const result = yield* intake.agent
    .submit({
      agentRef: contact.agentRef,
      clientBucket: contact.clientBucket,
      email: contact.email,
      hold: contact.hold,
      score: contact.score,
      signals: contact.signals,
      source: "agent",
      submissionId: contact.submissionId,
      ticket: contact.ticket,
    })
    .pipe(Effect.timeoutOption(Duration.millis(remaining)));

  return Option.getOrElse(result, (): IntakeResult => outOfTime);
});

const deliver = createEffectLogic({
  effect: ({ input }) =>
    attempt(input).pipe(
      Effect.flatMap((result) =>
        Clock.currentTimeMillis.pipe(
          Effect.map((now) => ({
            remainingMillis: input.deadlineAt - now,
            result,
          }))
        )
      )
    ),
  schemas: { input: AttemptInputSchema },
});

const wait = createEffectLogic({
  effect: ({ input }) => Effect.sleep(Duration.seconds(input.seconds)),
  schemas: { input: Schema.Struct({ seconds: Schema.Finite }) },
});

export const joinDeliveryMachine = setupEffect({
  actors: { deliver, wait },
  schemas: { context: types<DeliveryContext>(), input: AttemptInputSchema },
}).createMachine({
  context: ({ input }) => ({
    ...input,
    attempts: 0,
    result: { kind: "refused" },
  }),
  initial: "submitting",
  output: ({ context }) => context.result,
  states: {
    settled: { type: "final" },
    submitting: {
      invoke: {
        input: ({ context }) => ({
          deadlineAt: context.deadlineAt,
          submissionId: context.submissionId,
        }),
        onDone: ({ context, event }) =>
          event.output.result.kind === "retry" &&
          event.output.result.afterSeconds <= MAX_DELIVERY_WAIT_SECONDS &&
          event.output.result.afterSeconds * 1000 <
            event.output.remainingMillis &&
          context.attempts < MAX_DELIVERY_RETRIES
            ? {
                context: {
                  attempts: context.attempts + 1,
                  result: event.output.result,
                },
                target: "waiting",
              }
            : { context: { result: event.output.result }, target: "settled" },
        src: "deliver",
      },
    },
    waiting: {
      invoke: {
        input: ({ context }) => ({
          seconds:
            context.result.kind === "retry" ? context.result.afterSeconds : 0,
        }),
        onDone: { target: "submitting" },
        src: "wait",
      },
    },
  },
});

export const runJoinDelivery = Effect.fn("runJoinDelivery")(
  function* runJoinDelivery(input: DeliveryInput) {
    const deadline = yield* JoinDeliveryDeadline;
    const startedAt = yield* Clock.currentTimeMillis;

    const actor = yield* createEffectActor(joinDeliveryMachine, {
      input: {
        deadlineAt: startedAt + Duration.toMillis(deadline),
        submissionId: input.submissionId,
      },
    });

    yield* watchActor("joinDeliveryMachine", actor);

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Machine-level defects are not domain failures; only the typed IntakeResult leaves the actor.
    return yield* join(actor).pipe(Effect.orDie);
  },
  Effect.scoped
);
