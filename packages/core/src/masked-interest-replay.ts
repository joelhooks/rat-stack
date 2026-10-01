import { Schema } from "effect";

export class MaskedInterestReplay extends Schema.TaggedError<MaskedInterestReplay>()(
  "MaskedInterestReplay",
  { message: Schema.String }
) {}
