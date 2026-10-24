import { Schema } from "effect";

export class SourceFault extends Schema.TaggedError<
  SourceFault,
  { readonly brand: unique symbol }
>()("SourceFault", {
  kind: Schema.Literals(["repo", "commit", "path", "unavailable"]),
}) {}
