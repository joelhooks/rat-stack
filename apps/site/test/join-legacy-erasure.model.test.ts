import { expect, it } from "@effect/vitest";
import { ContactRefSchema, IntakeEvents } from "@rat-stack/core/intake";
import { InterestTokens } from "@rat-stack/core/interest";
import {
  IntakeErasure,
  IntakeSweep,
  JoinContactStore,
} from "@rat-stack/core/join-interest";
import {
  makeMemoryIntakeVault,
  sealedIntakeEventsLayer,
} from "@rat-stack/intake-live";
import { Effect, Layer, Redacted, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { makeScriptedIntakeEvents } from "../../../packages/core/test/fixtures/scripted-intake-events.js";
import { scriptedIntakeLayer } from "../../../packages/core/test/fixtures/scripted-intake.js";
import {
  JOIN_CONTACT_KEY,
  joinContactCell,
} from "../src/interest/join-contact-cell.js";
import { joinContactStoreLayer } from "../src/interest/join-contact-store.js";

it.effect.prop(
  "legacy erasure recovers the event actor and a failed payload delete remains indexed until sweep recovery",
  {
    failDelete: Arbitrary.schema(Schema.Boolean),
    legacy: Arbitrary.schema(Schema.Boolean),
    state: Arbitrary.schema(Schema.Literals(["ready", "held"])),
  },
  ({ failDelete, legacy, state }) =>
    Effect.gen(function* eraseHistory() {
      const entries = new Map<string, unknown>();
      const pending = new Set<string>();
      const orphanedMarkers: string[] = [];
      const id = "synthetic-legacy-submission";
      let deleteUnavailable = false;

      const cell = joinContactCell({
        get: (key) => Effect.sync(() => entries.get(key)),
        put: (key, value) =>
          Effect.sync(() => {
            entries.set(key, value);

            if (key === "join-erase-request" && !pending.has(id)) {
              orphanedMarkers.push(id);
            }
          }),
        delete: (key) =>
          Effect.suspend(() =>
            key === JOIN_CONTACT_KEY && deleteUnavailable
              ? Effect.die("synthetic payload delete unavailable")
              : Effect.sync(() => entries.delete(key))
          ),
        setAlarm: () => Effect.void,
      });

      const vault = yield* makeMemoryIntakeVault;

      const originalEvents = yield* IntakeEvents.pipe(
        Effect.provide(sealedIntakeEventsLayer.pipe(Layer.provide(vault.layer)))
      );

      const contacts = yield* JoinContactStore.pipe(
        Effect.provide(
          joinContactStoreLayer(
            () => cell,
            () => Effect.void,
            (submissionId, marked) =>
              Effect.sync(() => {
                if (marked) {
                  pending.add(submissionId);
                } else {
                  pending.delete(submissionId);
                }
              })
          ).pipe(
            Layer.provide(
              InterestTokens.layer(Redacted.make("synthetic-legacy-secret"))
            )
          )
        )
      );

      const actor = yield* Schema.decodeEffect(ContactRefSchema)(
        "synthetic-legacy-contact"
      );

      yield* contacts.save({
        agentRef: "synthetic-agent",
        clientBucket: { ipHash: "synthetic-ip", uaHash: "synthetic-ua" },
        contactRef: actor,
        email: "synthetic@example.test",
        hold: state === "held",
        score: 0,
        signals: [],
        state,
        submissionId: id,
        ticket: "synthetic-ticket",
      });

      if (legacy) {
        const stored = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ sealed: Schema.String })
        )(entries.get(JOIN_CONTACT_KEY));

        entries.set(JOIN_CONTACT_KEY, stored.sealed);
        entries.delete("join-contact-meta");
      }

      pending.clear();
      yield* originalEvents.record([
        {
          actor,
          context: { intake: "tokenmaxx", submissionId: id },
          id: "0199a000-0000-7000-8000-000000000001",
          object: "tokenmaxx/intake",
          result: { name: "Synthetic Person", x: "https://x.com/synthetic" },
          timestamp: "2026-10-01T18:00:00.000Z",
          verb: "started",
        },
        {
          actor,
          context: { intake: "tokenmaxx", submissionId: id },
          id: "0199a000-0000-7000-8000-000000000002",
          object: "tokenmaxx/questions/building",
          result: "synthetic private answer",
          timestamp: "2026-10-01T18:00:00.000Z",
          verb: "answered",
        },
      ]);
      expect((yield* vault.contents).size).toBe(1);

      const events = yield* makeScriptedIntakeEvents({
        erase: originalEvents.erase,
      });

      const services = Layer.mergeAll(
        Layer.succeed(JoinContactStore, contacts),
        events.layer,
        scriptedIntakeLayer({
          agent: {},
        })
      );

      deleteUnavailable = failDelete;

      const result = yield* IntakeErasure.use((eraser) =>
        eraser.erase([id])
      ).pipe(Effect.provide(IntakeErasure.layer.pipe(Layer.provide(services))));

      expect(orphanedMarkers).toEqual([]);
      expect(yield* events.eraseCalls).toContain(actor);
      expect((yield* vault.contents).size).toBe(0);
      expect(result).toMatchObject({
        failed: 0,
        pending: failDelete ? 1 : 0,
        erased: failDelete ? 0 : 1,
        alreadyGone: 0,
      });
      expect(pending.has(id)).toBe(failDelete);
      expect(entries.has("join-erase-request")).toBe(failDelete);
      deleteUnavailable = false;

      if (pending.has(id)) {
        yield* IntakeSweep.use((sweep) => sweep.sweep([...pending])).pipe(
          Effect.provide(IntakeSweep.layer.pipe(Layer.provide(services)))
        );
      }

      expect(entries.has(JOIN_CONTACT_KEY)).toBe(false);
      expect(entries.has("join-erase-request")).toBe(false);
      expect(pending.size).toBe(0);
      expect((yield* vault.contents).size).toBe(0);
    }),
  { arbitrary: { runs: 100 } }
);
