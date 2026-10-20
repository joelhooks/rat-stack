import { Schema } from "effect";

export class CallNotFound extends Schema.TaggedError<
  CallNotFound,
  { readonly brand: unique symbol }
>()("CallNotFound", {
  firstIndex: Schema.Int,
  index: Schema.Int,
  nextIndex: Schema.Int,
}) {}
