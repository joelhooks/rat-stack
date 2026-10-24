import { Schema } from "effect";

export class InvalidTicket extends Schema.TaggedError<
  InvalidTicket,
  { readonly brand: unique symbol }
>()("InvalidTicket", {
  reason: Schema.Literals(["unknown", "expired", "reused"]),
}) {}
