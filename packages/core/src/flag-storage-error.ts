import { Schema } from "effect";

export class FlagStorageError extends Schema.TaggedError<
  FlagStorageError,
  { readonly brand: unique symbol }
>()("FlagStorageError", {
  cause: Schema.Defect(),
  fallback: Schema.Json,
  name: Schema.String,
  operation: Schema.Literals(["read", "write", "audit", "listChanges"]),
  repair: Schema.String,
}) {}
