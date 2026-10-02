import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeMissingPath extends Schema.TaggedError<CodeMissingPath>()(
  "CodeMissingPath",
  errorFields
) {}
