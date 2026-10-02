import { Schema } from "effect";

import { CodeFailure } from "./code-failure.ts";

export class CodeBuildFailed extends Schema.TaggedError<CodeBuildFailed>()(
  "CodeBuildFailed",
  {
    failures: Schema.optionalKey(Schema.Array(CodeFailure)),
    messages: Schema.Array(Schema.String),
  }
) {
  override get message() {
    return this.messages.join("\n");
  }
}
