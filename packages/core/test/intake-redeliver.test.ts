import { expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { ContactRefSchema } from "../src/intake-events.js";
import { IntakeRedeliver, intakeRedeliver } from "../src/intake-redeliver.js";
import { JoinContactStore } from "../src/join-contact-store.js";
import { makeScriptedIntake } from "./fixtures/scripted-intake.js";

const contactRef = Schema.decodeSync(ContactRefSchema)("synthetic-contact");

const Entry = Schema.Struct({
  hold: Schema.Boolean,
  result: Schema.Literals(["accepted", "refused", "retry"]),
  state: Schema.Literals([
    "ready",
    "held",
    "accepted",
    "refused",
    "missing",
    "erased",
  ]),
});

const storedStateAfterAttempt = (
  canSend: boolean,
  dryRun: boolean,
  result: typeof Entry.Type.result,
  state: string | undefined
) => (canSend && !dryRun && result !== "retry" ? "missing" : state);

const visitedCount = (length: number, dryRun: boolean, stop: number) =>
  dryRun || stop === -1 ? length : stop + 1;

const eligibleEntry = (
  entry: typeof Entry.Type,
  includeRefused: boolean,
  releaseHeld: boolean
) =>
  (!entry.hold || releaseHeld) &&
  (entry.state === "ready" ||
    entry.state === "held" ||
    (includeRefused && entry.state === "refused"));

it.effect.prop(
  "redelivery releases held contacts only with abuse-hold approval, sends eligible contacts in order and stops at the first non-accepted outcome",
  {
    dryRun: Arbitrary.schema(Schema.Boolean),
    entries: Arbitrary.array(Arbitrary.schema(Entry), {
      maxLength: 12,
      minLength: 1,
    }),
    includeRefused: Arbitrary.schema(Schema.Boolean),
    releaseHeld: Arbitrary.schema(Schema.Boolean),
  },
  ({ dryRun, entries, includeRefused, releaseHeld }) =>
    Effect.gen(function* verifyRedelivery() {
      const contacts = yield* JoinContactStore;

      const ids = entries.map((_entry, index) => `synthetic-${index}`);

      const outcomes = new Map(
        entries.map((entry, index) => [ids[index], entry.result])
      );

      for (const [index, entry] of entries.entries()) {
        const submissionId = ids[index] ?? "missing";

        if (entry.state === "missing") {
          continue;
        }

        yield* contacts.save({
          agentRef: "synthetic-agent",
          clientBucket: { ipHash: "a".repeat(64), uaHash: "b".repeat(64) },
          contactRef,
          email: "fictional@example.test",
          hold: entry.hold,
          score: entry.hold ? 1 : 0,
          signals: [],
          state: entry.state === "erased" ? "ready" : entry.state,
          submissionId,
          ticket: "synthetic-ticket",
        });

        if (entry.state === "erased") {
          yield* contacts.erase(submissionId);
        }
      }

      const intake = yield* makeScriptedIntake({
        agent: {
          submit: ({ submissionId }) => {
            const kind = outcomes.get(submissionId) ?? "refused";

            return Effect.succeed(
              kind === "retry" ? { afterSeconds: 60, kind } : { kind }
            );
          },
        },
      });

      const result = yield* intakeRedeliver
        .handler({ dryRun, includeRefused, releaseHeld, submissionIds: ids })
        .pipe(
          Effect.provide(
            IntakeRedeliver.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(JoinContactStore, contacts),
                  intake.layer
                )
              )
            )
          )
        );

      const stop = entries.findIndex(
        (entry) =>
          !eligibleEntry(entry, includeRefused, releaseHeld) ||
          entry.result !== "accepted"
      );

      const count = visitedCount(entries.length, dryRun, stop);
      const attempted = entries.slice(0, count);

      const eligible = attempted.flatMap((entry, index) =>
        !dryRun && eligibleEntry(entry, includeRefused, releaseHeld)
          ? [ids[index]]
          : []
      );

      const sent = yield* intake.agentCalls;
      expect(sent.map((input) => input.submissionId)).toEqual(eligible);
      expect(result.notAttempted).toEqual(ids.slice(count));
      expect(result.rows).toHaveLength(count);

      for (const [index, entry] of attempted.entries()) {
        const row = result.rows[index];

        const canSend = eligibleEntry(entry, includeRefused, releaseHeld);

        const state = entry.state === "erased" ? "missing" : entry.state;

        const deliveredState = {
          accepted: "accepted",
          refused: "refused",
          retry: "ready",
        };

        const sendOutcome = dryRun ? "would_send" : entry.result;
        expect(row).toEqual({
          hold:
            entry.state === "missing" || entry.state === "erased"
              ? null
              : entry.hold,
          outcome: canSend ? sendOutcome : "skipped",
          previousState: state,
          state: canSend && !dryRun ? deliveredState[entry.result] : state,
          submissionId: ids[index],
        });
        expect(
          (yield* contacts.read(ids[index] ?? "missing"))?.state ?? "missing"
        ).toBe(
          storedStateAfterAttempt(canSend, dryRun, entry.result, row?.state)
        );
      }

      expect(
        sent.every(
          (input) =>
            input.agentRef === "synthetic-agent" &&
            input.hold === false &&
            input.ticket === undefined &&
            input.signals === undefined
        )
      ).toBe(true);
      expect(JSON.stringify(result)).not.toContain("fictional@example.test");
      expect(JSON.stringify(result)).not.toContain("synthetic-ticket");
    }).pipe(Effect.provide(JoinContactStore.testLayer)),
  { arbitrary: { runs: 100 } }
);
