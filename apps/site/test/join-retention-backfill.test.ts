import { expect, it } from "@effect/vitest";
import { ContactRefSchema } from "@rat-stack/core/intake";
import { InterestTokens } from "@rat-stack/core/interest";
import {
  JOIN_CONTACT_RETENTION_MILLIS,
  JoinContactStore,
  JoinRetentionBackfill,
  joinRetentionBackfill,
} from "@rat-stack/core/join-interest";
import { Clock, Effect, Layer, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";

import {
  JOIN_CONTACT_KEY,
  joinContactCell,
} from "../src/interest/join-contact-cell.js";
import { joinContactStoreLayer } from "../src/interest/join-contact-store.js";
import { joinRetentionBackfillLayer } from "../src/interest/join-retention-backfill.js";

it.effect(
  "backfill previews readable legacy groups, migrates them once, and preserves explicit event-erasure work",
  () =>
    Effect.gen(function* migrationFixture() {
      const entries = new Map<string, Map<string, unknown>>();
      const alarms = new Map<string, number>();

      const cellFor = (id: string) => {
        const held = entries.get(id) ?? new Map<string, unknown>();
        entries.set(id, held);

        return joinContactCell({
          delete: (key) => Effect.sync(() => held.delete(key)),
          get: (key) => Effect.sync(() => held.get(key)),
          put: (key, value) =>
            Effect.sync(() => {
              held.set(key, value);
            }),
          setAlarm: (at) =>
            Effect.sync(() => {
              alarms.set(id, at);
            }),
        });
      };

      const contacts = yield* JoinContactStore.pipe(
        Effect.provide(
          joinContactStoreLayer(cellFor).pipe(
            Layer.provide(
              InterestTokens.layer(Redacted.make("synthetic-migration-key"))
            )
          )
        )
      );

      const start = yield* Clock.currentTimeMillis;

      const states = [
        "accepted",
        "refused",
        "ready",
        "held",
        "ready-held",
        "erase",
        "current",
      ] as const;

      for (const state of states) {
        const contact = {
          agentRef: "synthetic-agent",
          clientBucket: { ipHash: "synthetic-ip", uaHash: "synthetic-ua" },
          contactRef: yield* Schema.decodeEffect(ContactRefSchema)(
            `synthetic-${state}`
          ),
          email: "synthetic@example.test",
          hold: state === "ready-held",
          score: 0,
          signals: [],
          state:
            state === "erase" || state === "current" || state === "ready-held"
              ? ("ready" as const)
              : state,
          submissionId: state,
          ticket: "synthetic-ticket",
        };

        if (state === "current") {
          yield* contacts.save({
            ...contact,
            retentionDeadlineAt: start + JOIN_CONTACT_RETENTION_MILLIS,
          });
        } else if (state === "erase") {
          yield* contacts.save({ ...contact, pending: "erase" });
        } else {
          yield* contacts.save(contact);
        }

        if (state !== "current") {
          const held = entries.get(state);

          const value = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ sealed: Schema.String })
          )(held?.get(JOIN_CONTACT_KEY));

          held?.set(JOIN_CONTACT_KEY, value.sealed);
          held?.delete("join-contact-meta");
          held?.delete("join-erase-request");
          alarms.delete(state);
        }
      }

      cellFor("unreadable");
      entries
        .get("unreadable")
        ?.set(JOIN_CONTACT_KEY, "invalid-sealed-contact");
      const ids = [...states, "unreadable", "gone"];

      const service = yield* JoinRetentionBackfill.pipe(
        Effect.provide(
          joinRetentionBackfillLayer(() => Effect.succeed(ids)).pipe(
            Layer.provide(Layer.succeed(JoinContactStore, contacts))
          )
        )
      );

      const run = (apply?: boolean) =>
        joinRetentionBackfill
          .handler(apply === undefined ? {} : { apply })
          .pipe(Effect.provideService(JoinRetentionBackfill, service));

      const before = JSON.stringify(
        [...entries].map(([id, value]) => [id, [...value]])
      );

      const expected = {
        current: 1,
        erase: 1,
        finished: 2,
        gone: 1,
        legacyHandoffTimeUnknown: 8,
        nextCursor: null,
        pending: 3,
        unreadable: 1,
      };

      expect(yield* run()).toEqual(expected);
      expect(
        JSON.stringify(
          [...entries].flatMap(([id, value]) =>
            id === "gone" ? [] : [[id, [...value]]]
          )
        )
      ).toBe(before);
      expect(yield* run(true)).toEqual(expected);
      expect(yield* contacts.read("accepted")).toBeUndefined();
      expect(yield* contacts.read("refused")).toBeUndefined();
      expect(yield* contacts.read("erase")).toBeUndefined();
      expect(yield* contacts.readErasure("erase")).toMatchObject({
        contactRef: "synthetic-erase",
        pending: "erase",
      });
      expect(yield* contacts.requestErase("accepted")).toMatchObject({
        handedToDrovr: true,
        handedToDrovrAt: null,
      });

      expect(yield* contacts.read("held")).toMatchObject({
        state: "held",
        retentionDeadlineAt: start + JOIN_CONTACT_RETENTION_MILLIS,
      });
      expect(yield* contacts.read("ready-held")).toMatchObject({
        hold: true,
        retentionDeadlineAt: start + JOIN_CONTACT_RETENTION_MILLIS,
      });
      expect((yield* contacts.read("ready"))?.retentionDeadlineAt).toBe(
        start + JOIN_CONTACT_RETENTION_MILLIS
      );
      expect(alarms.get("ready")).toBe(start + JOIN_CONTACT_RETENTION_MILLIS);

      yield* TestClock.adjust("1 hour");
      expect(yield* run(true)).toEqual({
        current: 4,
        erase: 0,
        finished: 0,
        gone: 4,
        legacyHandoffTimeUnknown: 8,
        nextCursor: null,
        pending: 0,
        unreadable: 1,
      });

      expect((yield* contacts.read("ready"))?.retentionDeadlineAt).toBe(
        start + JOIN_CONTACT_RETENTION_MILLIS
      );
      expect(entries.get("unreadable")?.get(JOIN_CONTACT_KEY)).toBe(
        "invalid-sealed-contact"
      );

      yield* TestClock.adjust("24 hours");
      yield* cellFor("erase").alarm();
      expect(yield* contacts.readErasure("erase")).toBeDefined();
    })
);
