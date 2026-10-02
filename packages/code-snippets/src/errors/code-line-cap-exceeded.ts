import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeLineCapExceeded extends Schema.TaggedError<CodeLineCapExceeded>()(
  "CodeLineCapExceeded",
  errorFields
) {}
