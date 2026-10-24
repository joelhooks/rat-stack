import { Schema } from "effect";

export class NoPath extends Schema.TaggedError<
  NoPath,
  { readonly brand: unique symbol }
>()("NoPath", {
  from: Schema.String,
  message: Schema.String,
  to: Schema.String,
}) {}
