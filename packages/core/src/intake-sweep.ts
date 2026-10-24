import { Context, Effect, Layer } from "effect";

import { settleErase } from "./intake-erase.js";
import { IntakeEvents } from "./intake-events.js";
import { SubscriberIntake } from "./interest-intake.js";
import { JoinContactStore } from "./join-contact-store.js";
import {
  JoinDeliveryDeadline,
  deliveryStateFor,
  runJoinDelivery,
} from "./join-delivery-machine.js";

export const SWEEP_CONCURRENCY = 4;

export type IntakeSweepOutcome =
  | "delivered"
  | "deliveryPending"
  | "erased"
  | "erasePending"
  | "failed"
  | "idle"
  | "refused";

export type IntakeSweepCounts = Readonly<Record<IntakeSweepOutcome, number>>;

const countOutcomes = (
  outcomes: readonly IntakeSweepOutcome[]
): IntakeSweepCounts => {
  const counts = {
    delivered: 0,
    deliveryPending: 0,
    erasePending: 0,
    erased: 0,
    failed: 0,
    idle: 0,
    refused: 0,
  };

  for (const outcome of outcomes) {
    counts[outcome] += 1;
  }

  return counts;
};

const deliveryOutcome = {
  accepted: "delivered",
  refused: "refused",
  retry: "deliveryPending",
} as const satisfies Record<keyof typeof deliveryStateFor, IntakeSweepOutcome>;

export class IntakeSweep extends Context.Service<
  IntakeSweep,
  {
    readonly sweep: (
      submissionIds: readonly string[]
    ) => Effect.Effect<IntakeSweepCounts>;
  }
>()("@rat-stack/core/IntakeSweep") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* makeIntakeSweep() {
      const contacts = yield* JoinContactStore;
      const events = yield* IntakeEvents;
      const intake = yield* SubscriberIntake;
      const deliveryDeadline = yield* JoinDeliveryDeadline;

      const settle = Effect.fnUntraced(function* settle(
        submissionId: string
      ): Effect.fn.Return<IntakeSweepOutcome> {
        const contact = yield* contacts.read(submissionId);

        if (contact?.pending === "erase") {
          const erased = yield* settleErase(contacts, events, submissionId);

          return erased === "pending" ? "erasePending" : "erased";
        }

        if (
          contact?.pending !== "delivery" ||
          contact.state !== "ready" ||
          contact.hold
        ) {
          return "idle";
        }

        const result = yield* runJoinDelivery({ submissionId }).pipe(
          Effect.provideService(SubscriberIntake, intake),
          Effect.provideService(JoinContactStore, contacts),
          Effect.provideService(JoinDeliveryDeadline, deliveryDeadline)
        );

        yield* contacts.setState(submissionId, deliveryStateFor[result.kind]);

        return deliveryOutcome[result.kind];
      });

      const sweep = (submissionIds: readonly string[]) =>
        Effect.forEach(
          [...new Set(submissionIds)],
          (submissionId) =>
            settle(submissionId).pipe(
              Effect.catchCause(() => Effect.succeed("failed" as const))
            ),
          { concurrency: SWEEP_CONCURRENCY }
        ).pipe(Effect.map(countOutcomes));

      return { sweep };
    })
  );
}
