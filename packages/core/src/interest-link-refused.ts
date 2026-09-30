import { Schema } from "effect";

export class InterestLinkRefused extends Schema.TaggedError<InterestLinkRefused>()(
  "InterestLinkRefused",
  {
    message: Schema.String,
    reason: Schema.Literals(["expired", "invalid"]),
  }
) {}
