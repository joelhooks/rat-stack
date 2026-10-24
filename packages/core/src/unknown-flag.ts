import { Schema } from "effect";

export class UnknownFlag extends Schema.TaggedError<
  UnknownFlag,
  { readonly brand: unique symbol }
>()("UnknownFlag", { name: Schema.String, repair: Schema.String }) {}
