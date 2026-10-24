import { Schema } from "effect";

export class RollbackRefused extends Schema.TaggedError<
  RollbackRefused,
  { readonly brand: unique symbol }
>()("RollbackRefused", { reason: Schema.String }) {}
