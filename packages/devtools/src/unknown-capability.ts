import { Schema } from "effect";

export class UnknownCapability extends Schema.TaggedError<
  UnknownCapability,
  { readonly brand: unique symbol }
>()("UnknownCapability", {
  available: Schema.Array(Schema.String),
  name: Schema.String,
}) {}
