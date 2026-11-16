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
import {
  JOIN_CONTACT_RETENTION_MILLIS,
  JoinContactStore,
} from "./join-contact-store.js";

export const JoinDeliveryDeadline = Context.Reference<Duration.Duration>(
  "@rat-stack/core/JoinDeliveryDeadline",
  { defaultValue: () => Duration.seconds(25) }
);

const DeliveryInputSchema = Schema.Struct({ submissionId: Schema.String });

interface DeliveryContext {
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
  input: typeof DeliveryInputSchema.Type
) {
  const contacts = yield* JoinContactStore;
  const intake = yield* SubscriberIntake;
  const budget = yield* JoinDeliveryDeadline;
  const contact = yield* contacts.read(input.submissionId);
  const erasure = yield* contacts.readErasure(input.submissionId);

  if (
    contact === undefined ||
    contact.pending === "erase" ||
    erasure !== undefined
  ) {
    return { kind: "refused" } as const;
  }

  const now = yield* Clock.currentTimeMillis;

  const retentionDeadlineAt =
    contact.retentionDeadlineAt ?? now + JOIN_CONTACT_RETENTION_MILLIS;

  if (retentionDeadlineAt <= now) {
    yield* contacts.erase(input.submissionId);
    yield* Effect.logWarning("join delivery retention deadline reached");

    return { kind: "refused" } as const;
  }

  if (contact.hold || contact.state === "held") {
    return { kind: "retry", afterSeconds: 0 } as const;
  }

  if (contact.retryAt !== undefined && contact.retryAt > now) {
    return {
      afterSeconds: (contact.retryAt - now) / 1000,
      kind: "retry",
    } as const;
  }

  if (intake.agent === undefined || !intake.agent.enabled) {
    return { kind: "retry", afterSeconds: 0 } as const;
  }

  yield* contacts.save({ ...contact, retentionDeadlineAt });
  yield* contacts.markHandedToDrovr(input.submissionId);

  if (
    (yield* contacts.read(input.submissionId)) === undefined ||
    (yield* contacts.readErasure(input.submissionId)) !== undefined
  ) {
    return { kind: "refused" } as const;
  }

  const remaining = retentionDeadlineAt - (yield* Clock.currentTimeMillis);

  if (remaining <= 0) {
    yield* contacts.erase(input.submissionId);
    yield* Effect.logWarning("join delivery retention deadline reached");

    return { kind: "refused" } as const;
  }

  const result = yield* intake.agent
    .submit({
      agentRef: contact.agentRef,
      clientBucket: contact.clientBucket,
      email: contact.email,
      hold: contact.hold,
      score: contact.score,
      source: "agent",
      submissionId: input.submissionId,
    })
    .pipe(
      Effect.timeoutOption(
        Duration.millis(Math.min(Duration.toMillis(budget), remaining))
      )
    );

  return Option.getOrElse(result, (): IntakeResult => outOfTime);
});

const deliver = createEffectLogic({
  effect: ({ input }) => attempt(input),
  schemas: { input: DeliveryInputSchema },
});

const SettlementInputSchema = Schema.Struct({
  result: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("accepted") }),
    Schema.Struct({ kind: Schema.Literal("refused") }),
    Schema.Struct({
      afterSeconds: Schema.Finite,
      kind: Schema.Literal("retry"),
    }),
  ]),
  submissionId: Schema.String,
});

const settle = createEffectLogic({
  effect: ({ input }) =>
    Effect.gen(function* settleDelivery() {
      const contacts = yield* JoinContactStore;

      if (input.result.kind !== "retry") {
        yield* contacts.erase(input.submissionId);

        return;
      }

      const contact = yield* contacts.read(input.submissionId);

      if (contact === undefined || contact.hold || contact.state === "held") {
        return;
      }

      const erasure = yield* contacts.readErasure(input.submissionId);

      if (contact.pending === "erase" || erasure !== undefined) {
        yield* contacts.erase(input.submissionId);

        return;
      }

      const now = yield* Clock.currentTimeMillis;

      const retentionDeadlineAt =
        contact.retentionDeadlineAt ?? now + JOIN_CONTACT_RETENTION_MILLIS;

      const retryAt = now + input.result.afterSeconds * 1000;

      if (now >= retentionDeadlineAt || retryAt >= retentionDeadlineAt) {
        yield* contacts.erase(input.submissionId);

        yield* Effect.logWarning(
          "join delivery retention exhausted before retry"
        );

        return;
      }

      yield* contacts.save({ ...contact, retentionDeadlineAt, retryAt });
    }),
  schemas: { input: SettlementInputSchema },
});

export const joinDeliveryMachine = setupEffect({
  actors: { deliver, settle },
  schemas: { context: types<DeliveryContext>(), input: DeliveryInputSchema },
}).createMachine({
  context: ({ input }) => ({ ...input, result: { kind: "refused" } }),
  initial: "submitting",
  output: ({ context }) => context.result,
  states: {
    settled: { type: "final" },
    settling: {
      invoke: {
        input: ({ context }) => ({
          result: context.result,
          submissionId: context.submissionId,
        }),
        onDone: { target: "settled" },
        src: "settle",
      },
    },
    submitting: {
      invoke: {
        input: ({ context }) => ({ submissionId: context.submissionId }),
        onDone: ({ event }) => ({
          context: { result: event.output },
          target: "settling",
        }),
        src: "deliver",
      },
    },
  },
});

export const runJoinDelivery = Effect.fn("runJoinDelivery")(
  function* runJoinDelivery(input: typeof DeliveryInputSchema.Type) {
    const actor = yield* createEffectActor(joinDeliveryMachine, { input });

    yield* watchActor("joinDeliveryMachine", actor);

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Machine-level defects are not domain failures; only the typed IntakeResult leaves the actor.
    return yield* join(actor).pipe(Effect.orDie);
  },
  Effect.scoped
);
