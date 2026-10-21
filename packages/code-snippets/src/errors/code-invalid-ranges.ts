import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeInvalidRanges extends Schema.TaggedError<
  CodeInvalidRanges,
  { readonly brand: unique symbol }
>()("CodeInvalidRanges", errorFields) {}
