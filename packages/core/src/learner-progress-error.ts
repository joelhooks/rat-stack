import { Schema } from "effect";

export class LearnerProgressError extends Schema.TaggedError<
  LearnerProgressError,
  { readonly brand: unique symbol }
>()("LearnerProgressError", {
  cause: Schema.Defect(),
  operation: Schema.String,
}) {}
