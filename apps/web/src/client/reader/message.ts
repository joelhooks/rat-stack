import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";

import { DetectedClipboardAccess } from "./model.js";

export const Message = defineMessageUnion({
  ClickedCopy: { id: Schema.String },
  CompletedDetectClipboard: { access: DetectedClipboardAccess },
  CompletedWaitBeforeCopyReset: { id: Schema.String },
  FailedCopyReaderText: { id: Schema.String },
  SucceededCopyReaderText: { id: Schema.String },
});

export type ReaderMessage = typeof Message.Type;
