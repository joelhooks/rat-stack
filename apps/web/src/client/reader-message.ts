import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";

export const ReaderMessage = defineMessageUnion({
  ClipboardReady: { available: Schema.Boolean },
  CopyFailed: { id: Schema.String },
  CopyRequested: { id: Schema.String },
  CopyStatusExpired: { id: Schema.String },
  CopySucceeded: { id: Schema.String },
});
