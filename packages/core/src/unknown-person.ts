import { Schema } from "effect";

export class UnknownPerson extends Schema.TaggedError<
  UnknownPerson,
  { readonly brand: unique symbol }
>()("UnknownPerson", { id: Schema.String, message: Schema.String }) {}
