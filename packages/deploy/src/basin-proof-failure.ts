import { Schema } from "effect";

export class BasinProofFailure extends Schema.TaggedError<BasinProofFailure>()(
  "BasinProofFailure",
  {
    completed: Schema.Natural,
    reason: Schema.Literals([
      "plan-refused",
      "apply-failed",
      "engine-failed",
      "catalog-token-scope-required",
      "destroy-failed",
    ]),
  }
) {}
