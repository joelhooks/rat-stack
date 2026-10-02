import { describe, expect, it } from "@effect/vitest";
import {
  ContactRefSchema,
  IntakeEventsUnavailable,
} from "@rat-stack/core/intake";
import type { IntakeStatement, QuestionId } from "@rat-stack/core/intake";
import { Effect, Exit, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { basinIntakeEvents, IntakeRowSchema } from "../src/index.js";
import type { IntakeRow, UnstructuredIntakeRow } from "../src/index.js";

const submissions = [0, 1, 2] as const;

type Submission = (typeof submissions)[number];

const questions = ["building", "today", "leaveWith"] as const;

const actorOf = (submission: Submission) =>
  Schema.decodeSync(ContactRefSchema)(`contact-${submission}`);

const emailOf = (submission: Submission) => `person-${submission}@example.com`;

const answerOf = (submission: Submission, question: QuestionId) =>
  `answer ${question} from ${submission}`;

const heldOf = (submission: Submission) => submission === 1;

const idOf = (submission: Submission, slot: number) =>
  `0199a000-0000-7000-800${submission}-00000000000${slot}`;

const Step = Schema.Union([
  Schema.Struct({
    answered: Schema.Tuple([Schema.Boolean, Schema.Boolean, Schema.Boolean]),
    kind: Schema.Literal("record"),
    submission: Schema.Literals(submissions),
    withContact: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("erase"),
    submission: Schema.Literals(submissions),
  }),
  Schema.Struct({
    failures: Schema.Literals([1, 3]),
    kind: Schema.Literal("outage"),
  }),
]);

type GeneratedStep = typeof Step.Type;

const steps = Arbitrary.array(Arbitrary.schema(Step), { maxLength: 30 });

const statementsFor = (
  submission: Submission,
  answered: readonly [boolean, boolean, boolean]
) => {
  const base = {
    actor: actorOf(submission),
    context: { intake: "tokenmaxx", submissionId: `submission-${submission}` },
    timestamp: "2026-10-02T08:32:23.000Z",
  } as const;

  const answers: IntakeStatement[] = questions.flatMap((question, slot) =>
    answered[slot] === true
      ? [
          {
            ...base,
            id: idOf(submission, slot),
            object: `tokenmaxx/questions/${question}`,
            result: answerOf(submission, question),
            verb: "answered",
          },
        ]
      : []
  );

  const submitted: IntakeStatement = {
    ...base,
    id: idOf(submission, 3),
    object: "tokenmaxx/intake",
    result: { held: heldOf(submission), score: 0.25, signals: ["jev_clear"] },
    verb: "submitted",
  };

  return [...answers, submitted];
};

interface Application {
  readonly answers: ReadonlyMap<string, string>;
  readonly email: string | undefined;
  readonly held: boolean;
}

const decodeRow = Schema.decodeUnknownSync(IntakeRowSchema);

const readApplications = (sent: readonly UnstructuredIntakeRow[]) => {
  const rows = new Map<string, IntakeRow>();

  for (const { value } of sent) {
    const row = decodeRow(value);

    if (!rows.has(row.id)) {
      rows.set(row.id, row);
    }
  }

  const erased = new Set(
    [...rows.values()].flatMap((row) =>
      row.kind === "erased" ? [row.actor] : []
    )
  );

  const contacts = new Map<string, number>();
  const applications = new Map<string, Application>();

  for (const row of rows.values()) {
    if (row.kind === "erased" || erased.has(row.actor)) {
      continue;
    }

    const held = applications.get(row.submissionId) ?? {
      answers: new Map<string, string>(),
      email: undefined,
      held: false,
    };

    if (row.kind === "contact") {
      contacts.set(row.submissionId, (contacts.get(row.submissionId) ?? 0) + 1);
      applications.set(row.submissionId, { ...held, email: row.email });
      continue;
    }

    if (row.verb === "answered" && Schema.is(Schema.String)(row.result)) {
      applications.set(row.submissionId, {
        ...held,
        answers: new Map(held.answers).set(row.object, row.result),
      });
      continue;
    }

    if (row.verb === "submitted") {
      applications.set(row.submissionId, {
        ...held,
        held: Schema.is(Schema.Struct({ held: Schema.Literal(true) }))(
          row.result
        ),
      });
    }
  }

  return { applications, contacts };
};

interface ModelSubmission {
  answered: Set<QuestionId>;
  contact: boolean;
}

const expectedApplications = (
  model: ReadonlyMap<Submission, ModelSubmission>,
  erased: ReadonlySet<Submission>
) => {
  const expected = new Map<string, Application>();

  for (const [submission, recorded] of model) {
    if (erased.has(submission)) {
      continue;
    }

    expected.set(`submission-${submission}`, {
      answers: new Map(
        [...recorded.answered].map((question) => [
          `tokenmaxx/questions/${question}`,
          answerOf(submission, question),
        ])
      ),
      email: recorded.contact ? emailOf(submission) : undefined,
      held: heldOf(submission),
    });
  }

  return expected;
};

const runAgainstModel = (generated: readonly GeneratedStep[]) =>
  Effect.gen(function* replay() {
    const sent = yield* Ref.make<readonly UnstructuredIntakeRow[]>([]);
    const failuresLeft = yield* Ref.make(0);

    const { events } = basinIntakeEvents({
      send: (rows) =>
        Effect.gen(function* send() {
          const left = yield* Ref.get(failuresLeft);

          if (left > 0) {
            yield* Ref.set(failuresLeft, left - 1);

            return yield* new IntakeEventsUnavailable({});
          }

          return yield* Ref.update(sent, (all) => [...all, ...rows]);
        }),
    });

    const model = new Map<Submission, ModelSubmission>();
    const erased = new Set<Submission>();
    let outage = 0;

    for (const step of generated) {
      if (step.kind === "outage") {
        outage = step.failures;
        yield* Ref.set(failuresLeft, step.failures);
        continue;
      }

      if (step.kind === "erase") {
        const exit = yield* Effect.exit(events.erase(actorOf(step.submission)));
        const survives = outage <= 2;
        outage = survives ? 0 : outage - 3;

        expect(Exit.isSuccess(exit)).toBe(survives);

        if (survives) {
          erased.add(step.submission);
        }

        continue;
      }

      const exit = yield* Effect.exit(
        events.record(
          statementsFor(step.submission, step.answered),
          step.withContact
            ? { agentRef: "agent-under-test", email: emailOf(step.submission) }
            : undefined
        )
      );

      if (outage > 0) {
        outage -= 1;
        expect(Exit.isFailure(exit)).toBe(true);
        continue;
      }

      expect(Exit.isSuccess(exit)).toBe(true);

      const recorded = model.get(step.submission) ?? {
        answered: new Set<QuestionId>(),
        contact: false,
      };

      for (const [slot, question] of questions.entries()) {
        if (step.answered[slot] === true) {
          recorded.answered.add(question);
        }
      }

      recorded.contact ||= step.withContact;
      model.set(step.submission, recorded);
    }

    const rows = yield* Ref.get(sent);
    const { applications, contacts } = readApplications(rows);

    expect(applications).toStrictEqual(expectedApplications(model, erased));

    for (const count of contacts.values()) {
      expect(count).toBe(1);
    }

    for (const { value } of rows) {
      const row = decodeRow(value);
      const serialized = JSON.stringify(value);

      expect(row.source).toBe("live");
      expect(serialized.includes("@example.com")).toBe(row.kind === "contact");
    }
  });

describe("basin intake events", () => {
  it.effect.prop(
    "write rows that read back as one application per submission, minus erased contacts, with the email only on the contact row",
    { generated: steps },
    ({ generated }) => runAgainstModel(generated),
    { arbitrary: { runs: 300 } }
  );

  it.effect("mark backfilled rows as backfill and keep the original time", () =>
    Effect.gen(function* backfillRows() {
      const sent = yield* Ref.make<readonly UnstructuredIntakeRow[]>([]);

      const { backfill } = basinIntakeEvents({
        send: (rows) => Ref.update(sent, (all) => [...all, ...rows]),
      });

      yield* backfill.record(statementsFor(0, [true, false, false]), {
        agentRef: "agent-under-test",
        email: emailOf(0),
      });

      const rows = (yield* Ref.get(sent)).map(({ value }) => decodeRow(value));

      expect(
        rows.map((row) => [row.kind, row.source, row.timestamp])
      ).toStrictEqual([
        ["statement", "backfill", "2026-10-02T08:32:23.000Z"],
        ["statement", "backfill", "2026-10-02T08:32:23.000Z"],
        ["contact", "backfill", "2026-10-02T08:32:23.000Z"],
      ]);
    })
  );
});
