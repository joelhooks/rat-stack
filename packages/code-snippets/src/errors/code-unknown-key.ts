import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeUnknownKey extends Schema.TaggedError<CodeUnknownKey>()(
  "CodeUnknownKey",
  errorFields
) {}
