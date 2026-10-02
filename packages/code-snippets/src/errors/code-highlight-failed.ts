import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeHighlightFailed extends Schema.TaggedError<CodeHighlightFailed>()(
  "CodeHighlightFailed",
  errorFields
) {}
