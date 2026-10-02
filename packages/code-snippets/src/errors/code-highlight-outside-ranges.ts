import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeHighlightOutsideRanges extends Schema.TaggedError<CodeHighlightOutsideRanges>()(
  "CodeHighlightOutsideRanges",
  errorFields
) {}
