import { Schema } from "effect";

export class SourceFault extends Schema.TaggedError<
  SourceFault,
  { readonly brand: unique symbol }
>()("SourceFault", {
  cause: Schema.optionalKey(Schema.Defect()),
  kind: Schema.Literals(["repo", "commit", "path", "unavailable"]),
}) {}
