import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class UnknownLanguage extends Schema.TaggedError<
  UnknownLanguage,
  { readonly brand: unique symbol }
>()("UnknownLanguage", errorFields) {}
