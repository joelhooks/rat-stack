import { Schema } from "effect";

import { CodeRequest } from "../model.ts";

export class ResolvedCode extends Schema.Class<
  ResolvedCode,
  { readonly brand: unique symbol }
>("ResolvedCode")({
  actualLength: Schema.Finite,
  request: CodeRequest,
  source: Schema.String,
}) {}
