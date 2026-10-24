import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeLineCapExceeded extends Schema.TaggedError<
  CodeLineCapExceeded,
  { readonly brand: unique symbol }
>()("CodeLineCapExceeded", errorFields) {}
