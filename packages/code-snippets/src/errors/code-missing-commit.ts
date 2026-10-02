import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeMissingCommit extends Schema.TaggedError<CodeMissingCommit>()(
  "CodeMissingCommit",
  errorFields
) {}
