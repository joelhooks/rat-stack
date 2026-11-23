import { expect, it } from "@effect/vitest";
import {
  Clock,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Ref,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";

import { IntakeErasure } from "../src/intake-erase.js";
import { IntakeEventsUnavailable } from "../src/intake-events-unavailable.js";
import type { IntakeResult } from "../src/interest-intake.js";
import {
  JOIN_CONTACT_RETENTION_MILLIS,
  JoinContactSchema,
  JoinContactStore,
} from "../src/join-contact-store.js";
import { runJoinDelivery } from "../src/join-delivery-machine.js";
import { scriptedIntakeEventsLayer } from "./fixtures/scripted-intake-events.js";
import { scriptedIntakeLayer } from "./fixtures/scripted-intake.js";

it.effect.prop(
  "erasure before, during or after every delivery result removes sealed data, retains its marker until the tombstone, and stops intake",
  {
    contact: JoinContactSchema,
    order: Schema.Literals(["before", "during", "after"]),
    outcome: Schema.Literals([
      "accepted",
      "unavailable",
      "budget",
      "invalid",
      "challenge",
      "timeout",
      "crash",
    ]),
    advance: Schema.Int.check(
      Schema.isBetween({ minimum: 86_399, maximum: 86_401 })
    ),
  },
  ({ contact, order, outcome, advance }) =>
    Effect.gen(function* eraseHistory() {
      const contacts = yield* JoinContactStore;
      const completion = yield* Deferred.make<IntakeResult>();
      const down = yield* Ref.make(true);
      const sent: string[] = [];

      const events = scriptedIntakeEventsLayer({
        erase: () =>
          Ref.get(down).pipe(
            Effect.flatMap((unavailable) =>
              unavailable
                ? Effect.fail(new IntakeEventsUnavailable({}))
                : Effect.void
            )
          ),
      });

      const erasure = yield* IntakeErasure.pipe(
        Effect.provide(
          IntakeErasure.layer.pipe(
            Layer.provide(
              Layer.mergeAll(events, Layer.succeed(JoinContactStore, contacts))
            )
          )
        )
      );

      const erase = erasure.erase([contact.submissionId]);
      yield* contacts.save({
        ...contact,
        hold: false,
        pending: "delivery",
        retentionDeadlineAt:
          (yield* Clock.currentTimeMillis) + JOIN_CONTACT_RETENTION_MILLIS,
        retryAt: 0,
        state: "ready",
      });

      const requestErase = Effect.gen(function* failTombstone() {
        const fiber = yield* Effect.forkChild(erase);
        yield* TestClock.adjust("10 seconds");
        const result = yield* Fiber.join(fiber);
        expect(result.pending).toBe(1);
        expect(yield* contacts.read(contact.submissionId)).toBeUndefined();
        expect(yield* contacts.readErasure(contact.submissionId)).toBeDefined();
      });

      const delivery = runJoinDelivery({
        submissionId: contact.submissionId,
      }).pipe(
        Effect.provide(
          scriptedIntakeLayer({
            agent: {
              submit: (request) =>
                Effect.sync(() => {
                  sent.push(request.submissionId);
                }).pipe(
                  Effect.andThen(Deferred.await(completion)),
                  Effect.flatMap((answer) =>
                    outcome === "crash"
                      ? Effect.die("synthetic crash before response")
                      : Effect.succeed(answer)
                  )
                ),
            },
          })
        )
      );

      if (order === "before") {
        yield* requestErase;
      }

      const firstDispatchAt = DateTime.formatIso(yield* DateTime.now);
      const dispatched = order !== "before";
      const fiber = yield* Effect.forkChild(Effect.exit(delivery));
      yield* TestClock.adjust(0);

      if (order === "during") {
        yield* requestErase;
      }

      const kinds = {
        accepted: "accepted",
        invalid: "refused",
        challenge: "refused",
        unavailable: "retry",
        budget: "retry",
        timeout: "retry",
        crash: "retry",
      } as const;

      const kind = kinds[outcome];

      const result: IntakeResult =
        kind === "retry" ? { kind, afterSeconds: 30 } : { kind };

      if (outcome !== "timeout") {
        yield* Deferred.succeed(completion, result);
      }

      yield* TestClock.adjust("25 seconds");
      const delivered = yield* Fiber.join(fiber);
      expect(Exit.isFailure(delivered)).toBe(outcome === "crash" && dispatched);

      if (order === "after") {
        yield* requestErase;
      }

      yield* TestClock.adjust(advance * 1000);
      expect(yield* contacts.read(contact.submissionId)).toBeUndefined();
      expect(
        (yield* contacts.readErasure(contact.submissionId))?.handedToDrovr
      ).toBe(dispatched);
      expect(
        (yield* contacts.readErasure(contact.submissionId))?.handedToDrovrAt
      ).toBe(dispatched ? firstDispatchAt : null);
      yield* delivery;
      expect(sent).toEqual(order === "before" ? [] : [contact.submissionId]);
      yield* Ref.set(down, false);
      const final = yield* erase;
      expect(final.erased).toBe(1);
      expect(final.handedToDrovr).toBe(dispatched ? 1 : 0);
      expect(final.handedToDrovrSubmissionIds).toEqual(
        dispatched ? [contact.submissionId] : []
      );
      expect(final.handedToDrovrSubmissions).toEqual(
        dispatched
          ? [{ submissionId: contact.submissionId, handedAt: firstDispatchAt }]
          : []
      );
      expect(yield* contacts.readErasure(contact.submissionId)).toBeUndefined();
      expect(yield* contacts.read(contact.submissionId)).toBeUndefined();
    }).pipe(Effect.scoped, Effect.provide(JoinContactStore.testLayer)),
  { arbitrary: { runs: 200 } }
);

it.effect.prop(
  "missing history and failed reads still report possible handoffs without losing known dispatch time",
  {
    contact: JoinContactSchema,
    missing: Schema.Boolean,
    unreadable: Schema.Boolean,
  },
  ({ contact, missing, unreadable }) =>
    Effect.gen(function* uncertainHandoffHistory() {
      const contacts = yield* JoinContactStore;
      const firstDispatchAt = DateTime.formatIso(yield* DateTime.now);

      if (!missing) {
        yield* contacts.save(contact);
        yield* contacts.markHandedToDrovr(contact.submissionId);
      }

      const services = Layer.mergeAll(
        Layer.succeed(JoinContactStore, {
          ...contacts,
          requestErase: (id) =>
            unreadable
              ? Effect.die("synthetic unreadable contact")
              : contacts.requestErase(id),
        }),
        scriptedIntakeEventsLayer({
          erase: () => Effect.void,
        })
      );

      const erasure = yield* IntakeErasure.pipe(
        Effect.provide(IntakeErasure.layer.pipe(Layer.provide(services)))
      );

      const result = yield* erasure.erase([contact.submissionId]);
      expect(result.handedToDrovrSubmissions).toEqual([
        {
          submissionId: contact.submissionId,
          handedAt: missing ? null : firstDispatchAt,
        },
      ]);
      expect(result.failed).toBe(unreadable ? 1 : 0);
      expect((yield* contacts.read(contact.submissionId)) !== undefined).toBe(
        !missing && unreadable
      );
    }).pipe(Effect.provide(JoinContactStore.testLayer))
);

it.effect.prop(
  "a failed durable handoff write prevents dispatch",
  { contact: JoinContactSchema },
  ({ contact }) =>
    Effect.gen(function* failedHandoffWrite() {
      const contacts = yield* JoinContactStore;
      let sent = 0;
      yield* contacts.save({
        ...contact,
        hold: false,
        state: "ready",
        pending: "delivery",
        retryAt: 0,
        retentionDeadlineAt:
          (yield* Clock.currentTimeMillis) + JOIN_CONTACT_RETENTION_MILLIS,
      });

      const result = yield* runJoinDelivery({
        submissionId: contact.submissionId,
      }).pipe(
        Effect.provideService(JoinContactStore, {
          ...contacts,
          markHandedToDrovr: () =>
            Effect.die("synthetic handoff write unavailable"),
        }),
        Effect.provide(
          scriptedIntakeLayer({
            agent: {
              submit: () =>
                Effect.sync(() => {
                  sent += 1;

                  return { kind: "accepted" } as const;
                }),
            },
          })
        ),
        Effect.exit
      );

      expect(Exit.isFailure(result)).toBe(true);
      expect(sent).toBe(0);
      expect(yield* contacts.read(contact.submissionId)).toBeDefined();
    }).pipe(Effect.scoped, Effect.provide(JoinContactStore.testLayer))
);
