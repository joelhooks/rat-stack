import { Schema } from "effect";

export class InvalidCrashTrace extends Schema.TaggedError<InvalidCrashTrace>()(
  "InvalidCrashTrace",
  {}
) {}
