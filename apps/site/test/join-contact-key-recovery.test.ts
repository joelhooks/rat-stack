import { expect, it } from "@effect/vitest";
import { ContactRefSchema } from "@rat-stack/core/intake";
import { InterestTokens } from "@rat-stack/core/interest";
import {
  JoinContactStore,
  JoinRetentionBackfill,
} from "@rat-stack/core/join-interest";
import { Cause, Effect, Exit, Layer, Redacted, Schema } from "effect";

import {
  JOIN_CONTACT_KEY,
  joinContactCell,
} from "../src/interest/join-contact-cell.js";
import { joinContactStoreLayer } from "../src/interest/join-contact-store.js";
import { joinRetentionBackfillLayer } from "../src/interest/join-retention-backfill.js";

it.effect(
  "a changed key leaves unreadable legacy bytes and their index untouched on reads and both migration modes",
  () =>
    Effect.gen(function* keyRecovery() {
      const entries = new Map<string, unknown>();
      const writes: unknown[] = [];
      const reads: string[] = [];

      const cell = joinContactCell({
        get: (key) =>
          Effect.sync(() => {
            reads.push(key);

            return entries.get(key);
          }),
        put: (key, value) =>
          Effect.sync(() => {
            entries.set(key, value);
            writes.push(key);
          }),
        delete: (key) =>
          Effect.sync(() => {
            entries.delete(key);
            writes.push(key);
          }),
        setAlarm: (at) =>
          Effect.sync(() => {
            writes.push(at);
          }),
      });

      const storeWithKey = (secret: string) =>
        JoinContactStore.pipe(
          Effect.provide(
            joinContactStoreLayer(
              () => cell,
              () =>
                Effect.sync(() => {
                  writes.push("index-note");
                }),
              (id, pending) =>
                Effect.sync(() => {
                  writes.push([id, pending]);
                })
            ).pipe(Layer.provide(InterestTokens.layer(Redacted.make(secret))))
          )
        );

      const original = yield* storeWithKey("synthetic-original-key");
      yield* original.save({
        agentRef: "synthetic-agent",
        clientBucket: { ipHash: "synthetic-ip", uaHash: "synthetic-ua" },
        contactRef:
          yield* Schema.decodeEffect(ContactRefSchema)("synthetic-contact"),
        email: "synthetic@example.test",
        hold: false,
        score: 0,
        signals: [],
        state: "ready",
        submissionId: "synthetic-key-recovery",
        ticket: "synthetic-ticket",
        pending: "delivery",
      });

      const envelope = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ sealed: Schema.String })
      )(entries.get(JOIN_CONTACT_KEY));

      entries.set(JOIN_CONTACT_KEY, envelope.sealed);
      entries.delete("join-contact-meta");
      writes.length = 0;
      const before = JSON.stringify([...entries]);
      const changed = yield* storeWithKey("synthetic-wrong-key");

      const result = yield* changed
        .read("synthetic-key-recovery")
        .pipe(Effect.exit);

      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result)) {
        expect(Cause.pretty(result.cause)).toContain("JoinContactUnreadable");
        expect(Cause.hasFails(result.cause)).toBe(true);
        expect(Cause.hasDies(result.cause)).toBe(false);
      }

      const backfill = yield* JoinRetentionBackfill.pipe(
        Effect.provide(
          joinRetentionBackfillLayer(() =>
            Effect.succeed(["synthetic-key-recovery"])
          ).pipe(Layer.provide(Layer.succeed(JoinContactStore, changed)))
        )
      );

      for (const dryRun of [true, false]) {
        expect(yield* backfill.run(dryRun)).toMatchObject({
          unreadable: 1,
          legacyHandoffTimeUnknown: 1,
        });
      }

      expect(JSON.stringify([...entries])).toBe(before);
      expect(writes).toEqual([]);
      reads.length = 0;
      expect(
        yield* changed.requestErase("synthetic-key-recovery")
      ).toBeUndefined();
      expect(reads).toContain(JOIN_CONTACT_KEY);
      expect(entries.has(JOIN_CONTACT_KEY)).toBe(false);
      expect(writes).toContainEqual(["synthetic-key-recovery", false]);
    })
);
