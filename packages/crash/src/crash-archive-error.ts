import { Schema } from "effect";

export class CrashArchiveError extends Schema.TaggedError<
  CrashArchiveError,
  { readonly brand: unique symbol }
>()("CrashArchiveError", { cause: Schema.optionalKey(Schema.Defect()) }) {}
