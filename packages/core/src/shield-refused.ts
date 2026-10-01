import { Schema } from "effect";

export class ShieldRefused extends Schema.TaggedError<ShieldRefused>()(
  "ShieldRefused",
  { reason: Schema.String }
) {}
