import { Schema } from "effect";

export class ReaderInputError extends Schema.TaggedError<ReaderInputError>()(
  "ReaderInputError",
  {
    cause: Schema.optional(Schema.Unknown),
    message: Schema.String,
    sourcePath: Schema.String,
  }
) {}
