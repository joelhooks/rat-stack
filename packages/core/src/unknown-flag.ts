import { Schema } from "effect";

export class UnknownFlag extends Schema.TaggedError<UnknownFlag>()(
  "UnknownFlag",
  { name: Schema.String, repair: Schema.String }
) {}
