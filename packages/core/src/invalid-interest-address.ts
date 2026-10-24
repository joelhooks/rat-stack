import { Schema } from "effect";

export class InvalidInterestAddress extends Schema.TaggedError<
  InvalidInterestAddress,
  { readonly brand: unique symbol }
>()("InvalidInterestAddress", { message: Schema.String }) {}
