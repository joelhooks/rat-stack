import { Command } from "@effect/ui";
import { Effect, Schema } from "effect";

import { ReaderMessage } from "./model.js";

export const DetectClipboard = Command.make(
  "reader/DetectClipboard",
  { args: {} },
  () =>
    Effect.sync(() =>
      ReaderMessage.CompletedDetectClipboard({
        available: navigator.clipboard !== undefined,
      })
    )
);

class ClipboardFailure extends Schema.TaggedError<
  ClipboardFailure,
  { readonly brand: unique symbol }
>()("ClipboardFailure", { cause: Schema.Unknown }) {}

export const CopyReaderText = Command.make(
  "reader/CopyReaderText",
  { args: { id: Schema.String, text: Schema.String }, mode: "concurrent" },
  ({ id, text }) =>
    Effect.tryPromise({
      catch: (cause) => new ClipboardFailure({ cause }),
      try: () => navigator.clipboard.writeText(text),
    }).pipe(
      Effect.match({
        onFailure: () => ReaderMessage.FailedCopyReaderText({ id }),
        onSuccess: () => ReaderMessage.SucceededCopyReaderText({ id }),
      })
    )
);

export const WaitBeforeCopyReset = Command.make(
  "reader/WaitBeforeCopyReset",
  { args: { id: Schema.String }, mode: "concurrent" },
  ({ id }) =>
    Effect.sleep("2 seconds").pipe(
      Effect.as(ReaderMessage.CompletedWaitBeforeCopyReset({ id }))
    )
);
