import { Effect, Schema } from "effect";
import { Command } from "foldkit";

import { Message } from "./message.js";
import { ClipboardAccess } from "./model.js";

class ClipboardFailure extends Schema.TaggedError<ClipboardFailure>()(
  "ClipboardFailure",
  { cause: Schema.Unknown }
) {}

export const DetectClipboard = Command.define("DetectClipboard", {
  execute: Effect.sync(() =>
    Message.CompletedDetectClipboard({
      access:
        navigator.clipboard === undefined
          ? ClipboardAccess.Unavailable()
          : ClipboardAccess.Available(),
    })
  ),
  messages: [Message.CompletedDetectClipboard],
});

export const CopyReaderText = Command.define("CopyReaderText", {
  args: { id: Schema.String, text: Schema.String },
  execute: ({ id, text }) =>
    Effect.tryPromise({
      catch: (cause) => new ClipboardFailure({ cause }),
      // @effect-diagnostics-next-line asyncFunction:off -- The native Clipboard API owns this Promise boundary.
      try: async () => {
        await navigator.clipboard.writeText(text);
      },
    }).pipe(
      Effect.match({
        onFailure: () => Message.FailedCopyReaderText({ id }),
        onSuccess: () => Message.SucceededCopyReaderText({ id }),
      })
    ),
  messages: [Message.FailedCopyReaderText, Message.SucceededCopyReaderText],
});

export const WaitBeforeCopyReset = Command.define("WaitBeforeCopyReset", {
  args: { id: Schema.String },
  execute: ({ id }) =>
    Effect.sleep("2 seconds").pipe(
      Effect.as(Message.CompletedWaitBeforeCopyReset({ id }))
    ),
  messages: [Message.CompletedWaitBeforeCopyReset],
});
