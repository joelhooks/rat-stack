import { Schema } from "effect";

export class InvalidFlagValue extends Schema.TaggedError<InvalidFlagValue>()(
  "InvalidFlagValue",
  { name: Schema.String, repair: Schema.String }
) {}
