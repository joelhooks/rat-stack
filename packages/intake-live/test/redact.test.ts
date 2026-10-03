import { describe, expect, it } from "@effect/vitest";
import { IntakeAnswersSchema } from "@rat-stack/core/intake";
import { Effect } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { MAX_SCORED_ANSWER_LENGTH, redactAnswer } from "../src/index.js";
import { redactAnswers } from "../src/redact.js";
import { answerText, leaksContact } from "./contact-shapes.js";

describe("answer redaction", () => {
  it.effect.prop(
    "redacts every supplied answer without losing nonblank answers",
    { answers: Arbitrary.schema(IntakeAnswersSchema) },
    ({ answers }) =>
      Effect.sync(() => {
        const redacted = redactAnswers(answers);

        const nonblank = Object.entries(answers).filter(
          ([, value]) => value.trim() !== ""
        );

        expect(Object.keys(redacted).toSorted()).toEqual(
          nonblank.map(([key]) => key).toSorted()
        );

        for (const [key, value] of nonblank) {
          expect(redacted).toHaveProperty(key, redactAnswer(value));
        }
      })
  );

  it.effect.prop(
    "leaves no email, link, or phone shape and stays under the cap",
    { text: answerText },
    ({ text }) =>
      Effect.sync(() => {
        const redacted = redactAnswer(text);

        expect(leaksContact(redacted)).toBe(false);
        expect(redacted.length).toBeLessThanOrEqual(MAX_SCORED_ANSWER_LENGTH);
      })
  );

  it.effect("keeps ordinary words and short numbers", () =>
    Effect.sync(() => {
      expect(redactAnswer("an agent harness for 12 people, e.g. evals")).toBe(
        "an agent harness for 12 people, e.g. evals"
      );
    })
  );
});
