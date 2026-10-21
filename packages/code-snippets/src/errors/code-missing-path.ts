import { Schema } from "effect";

import { errorFields } from "./fields.ts";

export class CodeMissingPath extends Schema.TaggedError<
  CodeMissingPath,
  { readonly brand: unique symbol }
>()("CodeMissingPath", errorFields) {}
