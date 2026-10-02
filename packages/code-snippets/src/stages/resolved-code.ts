import { Schema } from "effect";

import { CodeRequest } from "../model.ts";

export class ResolvedCode extends Schema.Class<ResolvedCode>("ResolvedCode")({
  actualLength: Schema.Finite,
  request: CodeRequest,
  source: Schema.String,
}) {}
