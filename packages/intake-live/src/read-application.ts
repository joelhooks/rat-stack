import { IntakeAnswersSchema } from "@rat-stack/core/intake";
import { IntakeApplicationsUnavailable } from "@rat-stack/core/join-interest";
import { Effect, Schema } from "effect";

import type { SealedRow } from "./intake-vault.js";
import { SealedStatementSchema, unsealResult } from "./sealed-intake-events.js";

const Verdict = Schema.Struct({
  held: Schema.Boolean,
  score: Schema.Finite,
  signals: Schema.Array(Schema.String),
});

const decodeRow = Schema.decodeUnknownEffect(
  Schema.fromJsonString(SealedStatementSchema)
);

export const unsealApplication = (rows: readonly SealedRow[], key: string) =>
  Effect.gen(function* readSealedApplication() {
    // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Effect.forEach is the Effect combinator, not an Array method with a thisArg.
    const statements = yield* Effect.forEach(rows, (row) =>
      decodeRow(row.sealed)
    );

    const submitted = statements.find(
      (row) => row.verb === "submitted" && row.object === "tokenmaxx/intake"
    );

    if (submitted === undefined || submitted.sealedResult === undefined) {
      return yield* new IntakeApplicationsUnavailable({});
    }

    const verdict = yield* unsealResult(key, submitted.sealedResult).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Verdict))
    );

    const answers: Record<string, string> = {};
    let share = false;

    for (const row of statements) {
      if (
        row.actor !== submitted.actor ||
        row.submissionId !== submitted.submissionId
      ) {
        return yield* new IntakeApplicationsUnavailable({});
      }

      if (row.sealedResult === undefined) {
        continue;
      }

      if (
        row.verb === "answered" &&
        row.object.startsWith("tokenmaxx/questions/")
      ) {
        answers[row.object.slice("tokenmaxx/questions/".length)] =
          yield* unsealResult(key, row.sealedResult).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.String))
          );
      }

      if (
        row.verb === "consented" &&
        row.object === "tokenmaxx/consents/share"
      ) {
        share = yield* unsealResult(key, row.sealedResult).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Boolean))
        );
      }
    }

    return {
      answers: yield* Schema.decodeEffect(IntakeAnswersSchema)(answers),
      contactRef: submitted.actor,
      hold: verdict.held,
      score: verdict.score,
      share,
      signals: verdict.signals,
      source: "agent" as const,
      submissionId: submitted.submissionId,
      submittedAt: submitted.timestamp,
    };
  }).pipe(
    Effect.withTracerEnabled(false),
    Effect.catchCause(() => Effect.fail(new IntakeApplicationsUnavailable({})))
  );
