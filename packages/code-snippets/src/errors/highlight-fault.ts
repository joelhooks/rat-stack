import { Schema } from "effect";

export class HighlightFault extends Schema.TaggedError<
  HighlightFault,
  { readonly brand: unique symbol }
>()("HighlightFault", {
  cause: Schema.optionalKey(Schema.Defect()),
  kind: Schema.Literals(["language", "render"]),
}) {}
