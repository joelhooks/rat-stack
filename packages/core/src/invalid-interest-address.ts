import { Schema } from "effect";

export class InvalidInterestAddress extends Schema.TaggedError<InvalidInterestAddress>()(
  "InvalidInterestAddress",
  { message: Schema.String }
) {}
