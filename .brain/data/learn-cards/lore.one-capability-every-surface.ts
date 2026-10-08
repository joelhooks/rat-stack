import { defineContract, implement } from "@rat-stack/capability";
import { Effect, Schema } from "effect";

export class EmptyText extends Schema.TaggedError<EmptyText>()("EmptyText", {
  fix: Schema.String,
}) {}

export const wordCountContract = defineContract("wordCount", {
  annotations: { idempotent: true, readOnly: true },
  description: "Count the words in a text.",
  failure: EmptyText,
  input: Schema.Struct({ text: Schema.String }),
  output: Schema.Struct({ words: Schema.Int }),
});

export const wordCount = implement(wordCountContract, ({ text }) =>
  text.trim() === ""
    ? Effect.fail(new EmptyText({ fix: "Send at least one word." }))
    : Effect.succeed({ words: text.trim().split(/\s+/u).length })
);
