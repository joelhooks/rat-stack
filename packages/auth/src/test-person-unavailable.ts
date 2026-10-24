import { Schema } from "effect";

export class TestPersonUnavailable extends Schema.TaggedError<
  TestPersonUnavailable,
  { readonly brand: unique symbol }
>()("TestPersonUnavailable", { message: Schema.String, name: Schema.String }) {}
