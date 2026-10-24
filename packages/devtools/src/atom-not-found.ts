import { Schema } from "effect";

export class AtomNotFound extends Schema.TaggedError<
  AtomNotFound,
  { readonly brand: unique symbol }
>()("AtomNotFound", {
  available: Schema.Array(Schema.String),
  key: Schema.String,
}) {}
