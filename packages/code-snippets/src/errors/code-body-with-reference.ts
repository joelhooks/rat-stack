import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeBodyWithReference extends Schema.TaggedError<
  CodeBodyWithReference,
  { readonly brand: unique symbol }
>()("CodeBodyWithReference", errorFields) {}
