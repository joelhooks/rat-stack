import { Schema } from "effect";

export class InvalidFlagValue extends Schema.TaggedError<
  InvalidFlagValue,
  { readonly brand: unique symbol }
>()("InvalidFlagValue", { flag: Schema.String, repair: Schema.String }) {}
