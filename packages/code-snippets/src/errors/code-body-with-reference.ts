import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeBodyWithReference extends Schema.TaggedError<CodeBodyWithReference>()(
  "CodeBodyWithReference",
  errorFields
) {}
