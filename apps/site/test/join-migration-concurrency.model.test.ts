import { expect, it } from "@effect/vitest";
import { ContactRefSchema } from "@rat-stack/core/intake";
import { InterestTokens } from "@rat-stack/core/interest";
import {
  IntakeSweep,
  JoinContactStore,
  JoinRetentionBackfill,
  runJoinDelivery,
} from "@rat-stack/core/join-interest";
import { Deferred, Effect, Fiber, Layer, Redacted, Schema } from "effect";

import { scriptedIntakeEventsLayer } from "../../../packages/core/test/fixtures/scripted-intake-events.js";
import { makeScriptedIntake } from "../../../packages/core/test/fixtures/scripted-intake.js";
import { sweepPendingIntake } from "../src/interest/intake-sweep.js";
import {
  JOIN_CONTACT_KEY,
  joinContactCell,
} from "../src/interest/join-contact-cell.js";
import { joinContactStoreLayer } from "../src/interest/join-contact-store.js";
import { joinRetentionBackfillLayer } from "../src/interest/join-retention-backfill.js";

it.effect.prop(
  "atomic real-adapter snapshots keep legacy contacts deliverable and indexed while migration, delivery and sweep overlap",
  { deliveryFirst: Schema.Boolean },
  ({ deliveryFirst }) =>
    Effect.gen(function* migrationOverlap() {
      const entries = new Map<string, unknown>();
      const noted = new Set<string>();
      const pending = new Set<string>();
      const id = "synthetic-migration-race";
      const captured = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();
      let reads = 0;
      let armed = false;

      const cell = joinContactCell({
        get: (key) => Effect.sync(() => entries.get(key)),
        put: (key, value) =>
          Effect.sync(() => {
            entries.set(key, value);
          }),
        delete: (key) => Effect.sync(() => entries.delete(key)),
        setAlarm: () => Effect.void,
      });

      const stub = {
        ...cell,
        joinReadSnapshot: () =>
          Effect.gen(function* snapshot() {
            const value = yield* cell.joinReadSnapshot();

            if (armed) {
              reads += 1;
              const ordinal = reads;

              if (ordinal === 2) {
                yield* Deferred.succeed(captured, true);
              }

              if (ordinal <= 2) {
                yield* Deferred.await(release);
              }
            }

            return value;
          }),
      };

      const markPending = (submissionId: string, value: boolean) =>
        Effect.sync(() => {
          if (value) {
            pending.add(submissionId);
          } else {
            pending.delete(submissionId);
          }
        });

      const contacts = yield* JoinContactStore.pipe(
        Effect.provide(
          joinContactStoreLayer(
            () => stub,
            (submissionId) =>
              Effect.sync(() => {
                noted.add(submissionId);
              }),
            markPending
          ).pipe(
            Layer.provide(
              InterestTokens.layer(Redacted.make("synthetic-race-key"))
            )
          )
        )
      );

      yield* contacts.save({
        agentRef: "synthetic-agent",
        clientBucket: { ipHash: "synthetic-ip", uaHash: "synthetic-ua" },
        contactRef: yield* Schema.decodeEffect(ContactRefSchema)(
          "synthetic-race-contact"
        ),
        email: "synthetic@example.test",
        hold: false,
        pending: "delivery",
        state: "ready",
        score: 0,
        signals: [],
        submissionId: id,
        ticket: "synthetic-ticket",
      });
      const sealed = yield* cell.joinRead();
      expect(sealed).toBeDefined();
      entries.set(JOIN_CONTACT_KEY, sealed);
      entries.delete("join-contact-meta");

      const intake = yield* makeScriptedIntake({
        agent: {
          submit: () => Effect.succeed({ kind: "retry", afterSeconds: 30 }),
        },
      });

      const base = Layer.mergeAll(
        Layer.succeed(JoinContactStore, contacts),
        scriptedIntakeEventsLayer(),
        intake.layer
      );

      const delivery = runJoinDelivery({ submissionId: id }).pipe(
        Effect.provide(base)
      );

      const sweeper = yield* IntakeSweep.pipe(
        Effect.provide(IntakeSweep.layer.pipe(Layer.provide(base)))
      );

      const sweep = sweepPendingIntake(
        () => Effect.sync(() => [...pending]),
        sweeper,
        contacts,
        markPending
      );

      armed = true;

      const first = yield* Effect.forkChild(
        deliveryFirst ? delivery.pipe(Effect.asVoid) : sweep.pipe(Effect.asVoid)
      );

      const second = yield* Effect.forkChild(
        deliveryFirst ? sweep.pipe(Effect.asVoid) : delivery.pipe(Effect.asVoid)
      );

      yield* Deferred.await(captured);
      yield* JoinRetentionBackfill.use((backfill) => backfill.run(false)).pipe(
        Effect.provide(
          joinRetentionBackfillLayer(() => Effect.sync(() => [...noted])).pipe(
            Layer.provide(base)
          )
        )
      );
      yield* Deferred.succeed(release, true);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      expect((yield* contacts.read(id))?.pending).toBe("delivery");
      expect((yield* contacts.read(id))?.state).toBe("ready");
      expect(pending.has(id)).toBe(true);
      expect(entries.get("join-erased")).not.toBe(true);
      const sent = yield* intake.agentCalls;
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.every((request) => request.submissionId === id)).toBe(true);
      expect([...noted]).toEqual([id]);
    }).pipe(Effect.scoped)
);
