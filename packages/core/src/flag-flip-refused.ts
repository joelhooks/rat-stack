import { Schema } from "effect";

export class FlagFlipRefused extends Schema.TaggedError<FlagFlipRefused>()(
  "FlagFlipRefused",
  {
    name: Schema.String,
    reason: Schema.Literals([
      "not-next-rung",
      "evidence-required",
      "approval-required",
      "unknown-rung",
      "off-refused",
    ]),
    repair: Schema.String,
  }
) {}
