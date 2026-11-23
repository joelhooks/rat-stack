import { expect, it } from "@effect/vitest";
import { ActorWatch } from "@rat-stack/capability/actor-watch";
import { ContactRefSchema } from "@rat-stack/core/intake";
import {
  IntakeApplications,
  IntakeSweep,
  JOIN_CONTACT_RETENTION_MILLIS,
  JoinContactStore,
  JoinContactUnreadable,
} from "@rat-stack/core/join-interest";
import { Clock, Effect, Layer, Logger, Schema } from "effect";

import { makeScriptedIntakeEvents } from "../../../packages/core/test/fixtures/scripted-intake-events.js";
import { makeScriptedIntake } from "../../../packages/core/test/fixtures/scripted-intake.js";
import { intakeApplicationsLayer } from "../src/interest/applications.js";
import { sweepPendingIntake } from "../src/interest/intake-sweep.js";

it.effect.prop(
  "one unreadable row cannot change other deliveries, erasures, pending entries or application rows; held rows never enter dispatch",
  {
    flags: Schema.Array(Schema.Boolean).check(
      Schema.isMinLength(3),
      Schema.isMaxLength(12)
    ),
    offset: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  },
  ({ flags, offset }) =>
    Effect.gen(function* isolationModel() {
      const ids = flags.map((_flag, index) => `synthetic-${index}`);
      const damaged = ids[2 + (offset % (ids.length - 2))] ?? "synthetic-2";
      const healthy = ids.filter((id) => id !== damaged);

      const eligible = ids.filter(
        (id, index) => id !== damaged && index > 1 && flags[index] === false
      );

      const scenario = Effect.fnUntraced(function* scenario(
        includeDamaged: boolean
      ) {
        const contacts = yield* JoinContactStore;

        const deadline =
          (yield* Clock.currentTimeMillis) + JOIN_CONTACT_RETENTION_MILLIS;

        for (const [index, id] of ids.entries()) {
          yield* contacts.save({
            agentRef: "synthetic-agent",
            clientBucket: { ipHash: "synthetic-ip", uaHash: "synthetic-ua" },
            contactRef: yield* Schema.decodeEffect(ContactRefSchema)(id),
            email: `${id}@example.test`,
            hold: index === 0 || flags[index] === true,
            state: "ready",
            pending: index === 1 ? "erase" : "delivery",
            retentionDeadlineAt: deadline,
            retryAt: 0,
            score: 0,
            signals: [],
            ticket: "synthetic-ticket",
            submissionId: id,
          });
        }

        const listedIds = includeDamaged ? ids : healthy;

        const port: JoinContactStore["Service"] = {
          ...contacts,
          read: (id) =>
            includeDamaged && id === damaged
              ? Effect.fail(
                  new JoinContactUnreadable({
                    reason: "contact unreadable",
                  })
                )
              : contacts.read(id),
        };

        const events = yield* makeScriptedIntakeEvents({
          erase: () => Effect.void,
        });

        const intake = yield* makeScriptedIntake({
          agent: { submit: () => Effect.succeed({ kind: "accepted" }) },
        });

        let dispatches = 0;

        const services = Layer.mergeAll(
          Layer.succeed(JoinContactStore, port),
          events.layer,
          intake.layer
        );

        const sweeper = yield* IntakeSweep.pipe(
          Effect.provide(IntakeSweep.layer.pipe(Layer.provide(services)))
        );

        const counts = yield* sweeper.sweep(listedIds).pipe(
          Effect.provideService(ActorWatch, {
            watch: () =>
              Effect.sync(() => {
                dispatches += 1;
              }),
          })
        );

        expect(dispatches).toBe(eligible.length);
        const pending = new Set(listedIds);
        yield* sweepPendingIntake(
          () => Effect.succeed(listedIds),
          sweeper,
          port,
          (id, value) =>
            Effect.sync(() => {
              if (value) {
                pending.add(id);
              } else {
                pending.delete(id);
              }
            })
        );

        const reader = yield* IntakeApplications.pipe(
          Effect.provide(
            intakeApplicationsLayer(
              () => Effect.succeed(listedIds),
              () => ({
                intakeRead: () => Effect.succeed({ key: undefined, rows: [] }),
              })
            ).pipe(Layer.provide(Layer.succeed(JoinContactStore, port)))
          )
        );

        const rows = yield* reader.list();

        return {
          counts,
          sent: (yield* intake.agentCalls)
            .map((request) => request.submissionId)
            .toSorted(),
          erased: (yield* events.eraseCalls).toSorted(),
          pending: [...pending].toSorted(),
          rows,
          damagedStored: (yield* contacts.read(damaged)) !== undefined,
        };
      }, Effect.provide(JoinContactStore.testLayer));

      const baseline = yield* scenario(false);
      const withDamage = yield* scenario(true);
      expect(baseline.sent).toEqual(eligible.toSorted());
      expect(withDamage.sent).toEqual(baseline.sent);
      expect(withDamage.erased).toEqual(baseline.erased);
      expect(withDamage.counts).toEqual({
        ...baseline.counts,
        failed: baseline.counts.failed + 1,
      });
      expect(withDamage.pending.filter((id) => id !== damaged)).toEqual(
        baseline.pending
      );
      expect(withDamage.pending).toContain(damaged);
      expect(
        withDamage.rows.filter((row) => row.submissionId !== damaged)
      ).toEqual(baseline.rows);
      expect(
        withDamage.rows.find((row) => row.submissionId === damaged)
      ).toEqual({
        submissionId: damaged,
        reason: "application unreadable",
        state: "unreadable",
      });
      expect(withDamage.damagedStored).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(Logger.layer([])))
);
