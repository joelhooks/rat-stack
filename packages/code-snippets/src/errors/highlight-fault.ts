import { Schema } from "effect";

export class HighlightFault extends Schema.TaggedError<HighlightFault>()(
  "HighlightFault",
  { kind: Schema.Literals(["language", "render"]) }
) {}
