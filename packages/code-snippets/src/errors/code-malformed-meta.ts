import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeMalformedMeta extends Schema.TaggedError<
  CodeMalformedMeta,
  { readonly brand: unique symbol }
>()("CodeMalformedMeta", errorFields) {}
