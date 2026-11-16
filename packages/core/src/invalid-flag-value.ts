import { Schema } from "effect";

export class InvalidFlagValue extends Schema.TaggedError<
  InvalidFlagValue,
  { readonly brand: unique symbol }
>()("InvalidFlagValue", {
  cause: Schema.optionalKey(Schema.Defect()),
  flag: Schema.String,
  repair: Schema.String,
}) {}
