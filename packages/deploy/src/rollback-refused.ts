import { Schema } from "effect";

export class RollbackRefused extends Schema.TaggedError<RollbackRefused>()(
  "RollbackRefused",
  { reason: Schema.String }
) {}
