import { expect, it } from "@effect/vitest";
import { ContactRefSchema } from "@rat-stack/core/intake";
import { InterestTokens } from "@rat-stack/core/interest";
import {
  JOIN_CONTACT_RETENTION_MILLIS,
  JoinContactStore,
  JoinRetentionBackfill,
} from "@rat-stack/core/join-interest";
import { Clock, Effect, Layer, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";

import { joinContactCell } from "../src/interest/join-contact-cell.js";
import { joinContactStoreLayer } from "../src/interest/join-contact-store.js";
import { joinRetentionBackfillLayer } from "../src/interest/join-retention-backfill.js";

it.effect.prop(
  "the cell deadline classifies fresh rows and overrides absent or extended plaintext deadlines without inventing a handoff",
  {
    extension: Schema.Int.check(
      Schema.isBetween({ minimum: 1, maximum: 86_400 })
    ),
    expireDuringRead: Schema.Boolean,
    elapsed: Schema.Int.check(
      Schema.isBetween({ minimum: 0, maximum: 86_401 })
    ),
  },
  ({ extension, elapsed, expireDuringRead }) =>
    Effect.gen(function* deadlineAuthority() {
      const entries = new Map<string, unknown>();
      let alarm = 0;

      const cell = joinContactCell({
        get: (key) => Effect.sync(() => entries.get(key)),
        put: (key, value) =>
          Effect.sync(() => {
            entries.set(key, value);
          }),
        delete: (key) => Effect.sync(() => entries.delete(key)),
        setAlarm: (at) =>
          Effect.sync(() => {
            alarm = at;
          }),
      });

      let expireAtDeadlineRead = false;

      const stub = {
        ...cell,
        joinReadSnapshot: () =>
          Effect.gen(function* deadlineRead() {
            if (expireAtDeadlineRead) {
              expireAtDeadlineRead = false;
              yield* TestClock.adjust(
                Math.max(0, alarm - (yield* Clock.currentTimeMillis))
              );
              yield* cell.alarm();
            }

            return yield* cell.joinReadSnapshot();
          }),
      };

      const contacts = yield* JoinContactStore.pipe(
        Effect.provide(
          joinContactStoreLayer(() => stub).pipe(
            Layer.provide(
              InterestTokens.layer(Redacted.make("synthetic-deadline-key"))
            )
          )
        )
      );

      const start = yield* Clock.currentTimeMillis;
      const deadline = start + JOIN_CONTACT_RETENTION_MILLIS;

      const contact = {
        agentRef: "synthetic-agent",
        clientBucket: { ipHash: "synthetic-ip", uaHash: "synthetic-ua" },
        contactRef: yield* Schema.decodeEffect(ContactRefSchema)(
          "synthetic-deadline-contact"
        ),
        email: "synthetic@example.test",
        hold: false,
        state: "ready" as const,
        pending: "delivery" as const,
        retryAt: 0,
        score: 0,
        signals: [],
        ticket: "synthetic-ticket",
        submissionId: "synthetic-deadline",
      };

      yield* contacts.save(contact);
      expect(
        (yield* contacts.read(contact.submissionId))?.retentionDeadlineAt
      ).toBe(deadline);
      expect(yield* contacts.readHandoff(contact.submissionId)).toMatchObject({
        handedToDrovr: false,
        handedToDrovrAt: null,
      });

      yield* contacts.save({
        ...contact,
        retentionDeadlineAt: deadline + extension * 1000,
      });
      expect(
        (yield* contacts.read(contact.submissionId))?.retentionDeadlineAt
      ).toBe(deadline);
      expect(alarm).toBe(deadline);
      yield* TestClock.adjust(elapsed * 1000);

      const preview = yield* JoinRetentionBackfill.pipe(
        Effect.provide(
          joinRetentionBackfillLayer(() =>
            Effect.succeed([contact.submissionId])
          ).pipe(Layer.provide(Layer.succeed(JoinContactStore, contacts)))
        )
      );

      expireAtDeadlineRead = expireDuringRead;
      const counts = yield* preview.run(true);
      const retained = elapsed < 86_400 && !expireDuringRead;
      expect(counts.current).toBe(retained ? 1 : 0);
      expect(counts.gone).toBe(retained ? 0 : 1);
      expect(entries.has("join-contact")).toBe(retained);
      expect((yield* contacts.read(contact.submissionId)) !== undefined).toBe(
        retained
      );
      expect(yield* contacts.readHandoff(contact.submissionId)).toMatchObject({
        handedToDrovr: false,
        handedToDrovrAt: null,
      });
      expect(yield* contacts.readErasure(contact.submissionId)).toBeUndefined();
    })
);
