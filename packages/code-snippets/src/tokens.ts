import { Schema } from "effect";

export const TokenSchema = Schema.Struct({
  color: Schema.optional(
    Schema.String.check(
      Schema.isPattern(/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/iu)
    )
  ),
  fontStyle: Schema.Finite,
  role: Schema.Literals(["ink", "keyword", "literal", "muted"]),
  text: Schema.String,
});

export type Token = typeof TokenSchema.Type;

export const SnippetLine = Schema.Struct({
  gapBefore: Schema.Finite,
  highlighted: Schema.Boolean,
  number: Schema.Finite,
  text: Schema.String,
  tokens: Schema.Array(TokenSchema),
});
