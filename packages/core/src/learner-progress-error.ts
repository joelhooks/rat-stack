import { Schema } from "effect";

export class LearnerProgressError extends Schema.TaggedError<LearnerProgressError>()(
  "LearnerProgressError",
  {
    cause: Schema.Defect(),
    operation: Schema.String,
  }
) {}
