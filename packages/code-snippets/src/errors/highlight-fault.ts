import { Schema } from "effect";

export class HighlightFault extends Schema.TaggedError<
  HighlightFault,
  { readonly brand: unique symbol }
>()("HighlightFault", { kind: Schema.Literals(["language", "render"]) }) {}
