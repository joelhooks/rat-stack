import { Schema } from "effect";

export const CopyPrompt = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  showText: Schema.Boolean,
  text: Schema.String,
});
