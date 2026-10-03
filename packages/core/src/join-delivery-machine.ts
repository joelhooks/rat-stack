import { watchActor } from "@rat-stack/capability/actor-watch";
import {
  createEffectActor,
  fromEffect,
  join,
  setupEffect,
} from "@xstate/effect";
import { Duration, Effect, Schema } from "effect";
import { types } from "xstate";

import { SubscriberIntake } from "./interest-intake.js";
import type { IntakeResult } from "./interest-intake.js";
import { JoinContactStore } from "./join-contact-store.js";

const DeliveryInputSchema = Schema.Struct({ submissionId: Schema.String });

type DeliveryInput = typeof DeliveryInputSchema.Type;

interface DeliveryContext extends DeliveryInput {
  readonly attempts: number;
  readonly result: IntakeResult;
}

const deliver = fromEffect({
  effect: ({ input }) =>
    Effect.gen(function* deliverContact() {
      const contacts = yield* JoinContactStore;
      const intake = yield* SubscriberIntake;
      const contact = yield* contacts.read(input.submissionId);

      if (
        contact === undefined ||
        contact.state === "held" ||
        contact.hold ||
        intake.agent === undefined
      ) {
        return { kind: "refused" } as const;
      }

      return yield* intake.agent.submit({
        agentRef: contact.agentRef,
        clientBucket: contact.clientBucket,
        email: contact.email,
        hold: contact.hold,
        score: contact.score,
        signals: contact.signals,
        source: "agent",
        submissionId: contact.submissionId,
        ticket: contact.ticket,
      });
    }),
  schemas: { input: DeliveryInputSchema },
});

const wait = fromEffect({
  effect: ({ input }) => Effect.sleep(Duration.seconds(input.seconds)),
  schemas: { input: Schema.Struct({ seconds: Schema.Finite }) },
});

export const joinDeliveryMachine = setupEffect({
  actors: { deliver, wait },
  schemas: { context: types<DeliveryContext>(), input: DeliveryInputSchema },
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
          submissionId: context.submissionId,
        }),
        onDone: ({ context, event }) =>
          event.output.kind === "retry" &&
          event.output.afterSeconds <= 3 &&
          context.attempts < 2
            ? {
                context: {
                  attempts: context.attempts + 1,
                  result: event.output,
                },
                target: "waiting",
              }
            : { context: { result: event.output }, target: "settled" },
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
    const actor = yield* createEffectActor(joinDeliveryMachine, { input });
    yield* watchActor("joinDeliveryMachine", actor);

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Machine-level defects are not domain failures; only the typed IntakeResult leaves the actor.
    return yield* join(actor).pipe(Effect.orDie);
  },
  Effect.scoped
);
