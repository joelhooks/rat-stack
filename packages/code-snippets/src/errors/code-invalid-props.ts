import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeInvalidProps extends Schema.TaggedError<CodeInvalidProps>()(
  "CodeInvalidProps",
  errorFields
) {}
