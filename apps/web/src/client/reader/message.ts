import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";

import { Message as CafeMessage } from "../cafe/message.js";
import { Message as DocsMessage } from "../docs/message.js";
import { Message as MotionDemoMessage } from "../motion/message.js";
import { DetectedClipboardAccess } from "./model.js";
import { OutlineRange } from "./outline-range.js";
import { PeekAnchor } from "./peek.js";
import { ReaderSettings } from "./settings.js";

export const Message = defineMessageUnion({
  ChoseSettings: { settings: ReaderSettings },
  ClickedCopy: { id: Schema.String },
  ClickedMenu: {},
  ClickedPhoneOutlineLink: {},
  ClickedSettings: {},
  CompletedDetectClipboard: { access: DetectedClipboardAccess },
  CompletedLightLinks: {},
  CompletedRevealOutlineRow: {},
  CompletedSaveSettings: {},
  CompletedWaitBeforeCopyReset: { id: Schema.String },
  ElapsedPeekWait: { route: Schema.String },
  FailedCopyReaderText: { id: Schema.String },
  FailedReadPeek: { route: Schema.String },
  FocusedLink: { anchor: PeekAnchor, route: Schema.String },
  GotCafeMessage: { message: CafeMessage },
  GotDocsMessage: { message: DocsMessage },
  GotMotionMessage: { message: MotionDemoMessage },
  HoveredGraphNode: { route: Schema.String },
  LeftGraphNode: {},
  LeftLink: {},
  LoadedSettings: { settings: ReaderSettings },
  PointedAtLink: { anchor: PeekAnchor, route: Schema.String },
  PressedEscape: {},
  ScrolledOutline: { range: OutlineRange },
  SucceededCopyReaderText: { id: Schema.String },
  SucceededReadPeek: {
    route: Schema.String,
    summary: Schema.String,
    title: Schema.String,
  },
  ToggledPhoneOutline: { open: Schema.Boolean },
});

export type ReaderMessage = typeof Message.Type;
