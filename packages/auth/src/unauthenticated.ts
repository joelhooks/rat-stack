import { Schema } from "effect";

export class Unauthenticated extends Schema.TaggedError<
  Unauthenticated,
  { readonly brand: unique symbol }
>()("Unauthenticated", { message: Schema.String }) {}
