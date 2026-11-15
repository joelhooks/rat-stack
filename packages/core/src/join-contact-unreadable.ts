import { Schema } from "effect";

export class JoinContactUnreadable extends Schema.TaggedError<
  JoinContactUnreadable,
  { readonly brand: unique symbol }
>()("JoinContactUnreadable", { cause: Schema.Defect() }) {}
