import { Schema } from "effect";

import { TokenSchema } from "../tokens.ts";
import { ResolvedCode } from "./resolved-code.ts";

export class HighlightedFile extends Schema.Class<HighlightedFile>(
  "HighlightedFile"
)({
  resolved: ResolvedCode,
  tokens: Schema.Array(Schema.Array(TokenSchema)),
}) {}
