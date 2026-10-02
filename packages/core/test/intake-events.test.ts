import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  ContactRefSchema,
  IntakeEvents,
  IntakeEventsTest,
  IntakeEventsUnavailable,
} from "../src/intake.js";
import type { IntakeStatement } from "../src/intake.js";

const contact = Schema.decodeSync(ContactRefSchema);

const contacts = [
  contact("contact-a"),
  contact("contact-b"),
  contact("contact-c"),
] as const;

const ids = [
  "0199a000-0000-7000-8000-000000000001",
  "0199a000-0000-7000-8000-000000000002",
  "0199a000-0000-7000-8000-000000000003",
  "0199a000-0000-7000-8000-000000000004",
] as const;

const Step = Schema.Union([
  Schema.Struct({
    contact: Schema.Literals([0, 1, 2]),
    id: Schema.Literals([0, 1, 2, 3]),
    kind: Schema.Literal("record"),
  }),
  Schema.Struct({
    contact: Schema.Literals([0, 1, 2]),
    kind: Schema.Literal("erase"),
  }),
]);

const steps = Arbitrary.array(Arbitrary.schema(Step), { maxLength: 30 });

const statementFor = (
  actorIndex: 0 | 1 | 2,
  idIndex: 0 | 1 | 2 | 3
): IntakeStatement => ({
  actor: contacts[actorIndex],
  context: { intake: "tokenmaxx", submissionId: `submission-${actorIndex}` },
  id: ids[idIndex],
  object: "tokenmaxx/questions/building",
  result: { response: "a harness" },
  timestamp: "2026-10-01T18:00:00.000Z",
  verb: "answered",
});

describe("intake events test layer", () => {
  it.effect.prop(
    "keeps one statement per id and drops every statement of an erased contact",
    { generated: steps },
    ({ generated }) =>
      Effect.gen(function* replay() {
        const events = yield* IntakeEvents;
        const recorded = new Map<string, IntakeStatement>();

        for (const step of generated) {
          if (step.kind === "erase") {
            const actor = contacts[step.contact];
            yield* events.erase(actor);

            for (const [id, statement] of recorded) {
              if (statement.actor === actor) {
                recorded.delete(id);
              }
            }

            continue;
          }

          const statement = statementFor(step.contact, step.id);
          yield* events.record([statement]);

          if (!recorded.has(statement.id)) {
            recorded.set(statement.id, statement);
          }
        }

        const stored = yield* (yield* IntakeEventsTest).statements;
        expect(stored).toStrictEqual([...recorded.values()]);
      }).pipe(Effect.provide(IntakeEvents.testLayer))
  );

  it.effect("fails every record when unavailable, so intake can hold", () =>
    Effect.gen(function* unavailable() {
      const events = yield* IntakeEvents;
      const failure = yield* Effect.flip(events.record([statementFor(0, 0)]));

      expect(failure).toStrictEqual(new IntakeEventsUnavailable({}));
    }).pipe(Effect.provide(IntakeEvents.unavailableTestLayer))
  );
});
