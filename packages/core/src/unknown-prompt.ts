import { Schema } from "effect";

export class UnknownPrompt extends Schema.TaggedError<
  UnknownPrompt,
  { readonly brand: unique symbol }
>()("UnknownPrompt", { message: Schema.String, slug: Schema.String }) {}
