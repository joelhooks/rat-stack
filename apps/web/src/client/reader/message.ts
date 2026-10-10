import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";

import { Message as CafeMessage } from "../cafe/message.js";
import { Message as DocsMessage } from "../docs/message.js";
import { DetectedClipboardAccess } from "./model.js";

export const Message = defineMessageUnion({
  ClickedCopy: { id: Schema.String },
  CompletedDetectClipboard: { access: DetectedClipboardAccess },
  CompletedWaitBeforeCopyReset: { id: Schema.String },
  FailedCopyReaderText: { id: Schema.String },
  GotCafeMessage: { message: CafeMessage },
  GotDocsMessage: { message: DocsMessage },
  SucceededCopyReaderText: { id: Schema.String },
});

export type ReaderMessage = typeof Message.Type;
