import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeRangeOutOfBounds extends Schema.TaggedError<
  CodeRangeOutOfBounds,
  { readonly brand: unique symbol }
>()("CodeRangeOutOfBounds", errorFields) {}
