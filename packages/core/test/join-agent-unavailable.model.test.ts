import { expect, it } from "@effect/vitest";
import { Clock, Effect, Schema } from "effect";
import { TestClock } from "effect/testing";

import { SubscriberIntake } from "../src/interest-intake.js";
import {
  JOIN_CONTACT_RETENTION_MILLIS,
  JoinContactSchema,
  JoinContactStore,
} from "../src/join-contact-store.js";
import { runJoinDelivery } from "../src/join-delivery-machine.js";

it.effect.prop(
  "a missing or disabled intake agent preserves signup, retry timing and the original deadline",
  {
    contact: JoinContactSchema,
    disabled: Schema.Boolean,
    dueIn: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 60 })),
    elapsed: Schema.Int.check(
      Schema.isBetween({ minimum: 0, maximum: 86_401 })
    ),
  },
  ({ contact, elapsed, dueIn, disabled }) =>
    Effect.gen(function* missingAgentHistory() {
      const contacts = yield* JoinContactStore;

      const start = yield* Clock.currentTimeMillis;
      const deadline = start + JOIN_CONTACT_RETENTION_MILLIS;
      const retryAt = start + dueIn * 1000;

      yield* contacts.save({
        ...contact,
        hold: false,
        state: "ready",
        pending: "delivery",
        retryAt,
        retentionDeadlineAt: deadline,
      });

      const browser = {
        submit: () => Effect.die("person intake must not run"),
      };

      const unavailable = disabled
        ? {
            ...browser,
            agent: {
              enabled: false,
              submit: () => Effect.die("disabled intake must not run"),
            },
          }
        : browser;

      const missing = yield* runJoinDelivery({
        submissionId: contact.submissionId,
      }).pipe(Effect.provideService(SubscriberIntake, unavailable));

      expect(missing.kind).toBe("retry");
      expect((yield* contacts.read(contact.submissionId))?.retryAt).toBe(
        retryAt
      );
      expect(
        (yield* contacts.read(contact.submissionId))?.retentionDeadlineAt
      ).toBe(deadline);
      expect(
        (yield* contacts.readHandoff(contact.submissionId))?.handedToDrovr
      ).toBe(false);

      yield* TestClock.adjust(elapsed * 1000);
      const sent: string[] = [];

      const recovered = yield* runJoinDelivery({
        submissionId: contact.submissionId,
      }).pipe(
        Effect.provideService(SubscriberIntake, {
          agent: {
            enabled: true,
            submit: (request) =>
              Effect.sync(() => {
                sent.push(request.submissionId);

                return { kind: "accepted" } as const;
              }),
          },
          submit: () => Effect.die("person intake must not run"),
        })
      );

      const pendingOrAccepted = elapsed < dueIn ? "retry" : "accepted";
      expect(recovered.kind).toBe(
        elapsed >= 86_400 ? "refused" : pendingOrAccepted
      );
      expect(sent).toEqual(
        elapsed >= dueIn && elapsed < 86_400 ? [contact.submissionId] : []
      );
      expect((yield* contacts.read(contact.submissionId)) !== undefined).toBe(
        elapsed < dueIn
      );
    }).pipe(Effect.scoped, Effect.provide(JoinContactStore.testLayer))
);
