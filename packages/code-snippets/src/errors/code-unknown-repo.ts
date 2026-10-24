import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeUnknownRepo extends Schema.TaggedError<
  CodeUnknownRepo,
  { readonly brand: unique symbol }
>()("CodeUnknownRepo", errorFields) {}
