import { Schema } from "effect";

export class InterestLinkRefused extends Schema.TaggedError<
  InterestLinkRefused,
  { readonly brand: unique symbol }
>()("InterestLinkRefused", {
  message: Schema.String,
  reason: Schema.Literals(["expired", "invalid"]),
}) {}
