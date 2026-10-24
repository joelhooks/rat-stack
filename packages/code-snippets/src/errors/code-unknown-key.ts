import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeUnknownKey extends Schema.TaggedError<
  CodeUnknownKey,
  { readonly brand: unique symbol }
>()("CodeUnknownKey", errorFields) {}
