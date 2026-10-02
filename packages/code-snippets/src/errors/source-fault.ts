import { Schema } from "effect";

export class SourceFault extends Schema.TaggedError<SourceFault>()(
  "SourceFault",
  { kind: Schema.Literals(["repo", "commit", "path", "unavailable"]) }
) {}
