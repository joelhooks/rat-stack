import { Schema } from "effect";

export class MaskedInterestReplay extends Schema.TaggedError<
  MaskedInterestReplay,
  { readonly brand: unique symbol }
>()("MaskedInterestReplay", { message: Schema.String }) {}
