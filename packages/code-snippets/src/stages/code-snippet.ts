import { Schema } from "effect";

import { CodeRequest } from "../model.ts";
import { SnippetLine } from "../tokens.ts";

export class CodeSnippet extends Schema.Class<CodeSnippet>("CodeSnippet")({
  lines: Schema.Array(SnippetLine),
  request: CodeRequest,
  url: Schema.String,
}) {}
