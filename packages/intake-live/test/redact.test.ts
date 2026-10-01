import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { MAX_SCORED_ANSWER_LENGTH, redactAnswer } from "../src/index.js";
import { answerText, leaksContact } from "./contact-shapes.js";

describe("answer redaction", () => {
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
