import { Schema } from "effect";

export class InvalidFlagJournal extends Schema.TaggedError<
  InvalidFlagJournal,
  { readonly brand: unique symbol }
>()("InvalidFlagJournal", { key: Schema.String, repair: Schema.String }) {}
