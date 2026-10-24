import { Schema } from "effect";

export class CafeDataError extends Schema.TaggedError<
  CafeDataError,
  { readonly brand: unique symbol }
>()("CafeDataError", {
  field: Schema.String,
  file: Schema.String,
  index: Schema.NullOr(Schema.Int),
  message: Schema.String,
}) {}
