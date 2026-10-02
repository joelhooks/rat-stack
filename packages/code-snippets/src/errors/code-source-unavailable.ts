import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeSourceUnavailable extends Schema.TaggedError<CodeSourceUnavailable>()(
  "CodeSourceUnavailable",
  errorFields
) {}
