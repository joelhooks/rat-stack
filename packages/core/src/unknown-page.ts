import { Schema } from "effect";

export class UnknownPage extends Schema.TaggedError<
  UnknownPage,
  { readonly brand: unique symbol }
>()("UnknownPage", {
  message: Schema.String,
  slug: Schema.String,
}) {}
