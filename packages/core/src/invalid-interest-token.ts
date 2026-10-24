import { Schema } from "effect";

export class InvalidInterestToken extends Schema.TaggedError<
  InvalidInterestToken,
  { readonly brand: unique symbol }
>()("InvalidInterestToken", {
  reason: Schema.Literals(["malformed", "signature", "expired"]),
}) {}
