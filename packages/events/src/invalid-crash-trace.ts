import { Schema } from "effect";

export class InvalidCrashTrace extends Schema.TaggedError<
  InvalidCrashTrace,
  { readonly brand: unique symbol }
>()("InvalidCrashTrace", {}) {}
