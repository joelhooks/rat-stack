import { Schema } from "effect";

export class UnknownPrompt extends Schema.TaggedError<UnknownPrompt>()(
  "UnknownPrompt",
  { message: Schema.String, slug: Schema.String }
) {}
