import { Schema } from "effect";

export class InvalidInterestToken extends Schema.TaggedError<InvalidInterestToken>()(
  "InvalidInterestToken",
  { reason: Schema.Literals(["malformed", "signature", "expired"]) }
) {}
