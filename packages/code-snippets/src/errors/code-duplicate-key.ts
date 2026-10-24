import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeDuplicateKey extends Schema.TaggedError<
  CodeDuplicateKey,
  { readonly brand: unique symbol }
>()("CodeDuplicateKey", errorFields) {}
