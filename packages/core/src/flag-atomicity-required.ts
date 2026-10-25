import { Schema } from "effect";

export class FlagAtomicityRequired extends Schema.TaggedError<
  FlagAtomicityRequired,
  { readonly brand: unique symbol }
>()("FlagAtomicityRequired", {
  flagName: Schema.String,
  repair: Schema.String,
}) {
  override get message() {
    return `${this.flagName}: ${this.repair}`;
  }
}
