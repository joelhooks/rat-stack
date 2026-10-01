import { Schema } from "effect";

export class InvalidTicket extends Schema.TaggedError<InvalidTicket>()(
  "InvalidTicket",
  { reason: Schema.Literals(["unknown", "expired", "reused"]) }
) {}
