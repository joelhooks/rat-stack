import { Schema } from "effect";

import { CodeFailure } from "./code-failure.ts";

export class CodeBuildFailed extends Schema.TaggedError<
  CodeBuildFailed,
  { readonly brand: unique symbol }
>()("CodeBuildFailed", {
  failures: Schema.optionalKey(Schema.Array(CodeFailure)),
  messages: Schema.Array(Schema.String),
}) {
  override get message() {
    return this.messages.join("\n");
  }
}
