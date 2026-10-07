import { Effect, Schema } from "effect";
import { Command } from "foldkit";

import { ReaderMessage } from "./reader-message.js";

class ClipboardFailure extends Schema.TaggedError<ClipboardFailure>()(
  "ClipboardFailure",
  { cause: Schema.Unknown }
) {}

export const DetectClipboard = Command.define("DetectClipboard", {
  execute: Effect.sync(() =>
    ReaderMessage.ClipboardReady({
      available: navigator.clipboard !== undefined,
    })
  ),
  messages: [ReaderMessage.ClipboardReady],
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
        onFailure: () => ReaderMessage.CopyFailed({ id }),
        onSuccess: () => ReaderMessage.CopySucceeded({ id }),
      })
    ),
  messages: [ReaderMessage.CopyFailed, ReaderMessage.CopySucceeded],
});

export const ExpireCopyStatus = Command.define("ExpireCopyStatus", {
  args: { id: Schema.String },
  execute: ({ id }) =>
    Effect.sleep("2 seconds").pipe(
      Effect.as(ReaderMessage.CopyStatusExpired({ id }))
    ),
  messages: [ReaderMessage.CopyStatusExpired],
});
