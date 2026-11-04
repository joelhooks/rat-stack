import { Effect, Schema } from "effect";
import { Command } from "foldkit";

import { Message } from "./message.js";
import { ClipboardAccess } from "./model.js";

class ClipboardFailure extends Schema.TaggedError<
  ClipboardFailure,
  { readonly brand: unique symbol }
>()("ClipboardFailure", { cause: Schema.Unknown }) {}

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
      try: () => navigator.clipboard.writeText(text),
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

const outlineRowMargin = 24;

const revealOutlineRow = (id: string) => {
  const rail = document.querySelector<HTMLElement>(".reader-rail");
  const row = rail?.querySelector<HTMLElement>(`a[href="#${CSS.escape(id)}"]`);

  if (
    rail === null ||
    rail === undefined ||
    row === null ||
    row === undefined
  ) {
    return;
  }

  const railBox = rail.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();

  if (rowBox.top < railBox.top + outlineRowMargin) {
    rail.scrollBy({ top: rowBox.top - railBox.top - outlineRowMargin });
  } else if (rowBox.bottom > railBox.bottom - outlineRowMargin) {
    rail.scrollBy({ top: rowBox.bottom - railBox.bottom + outlineRowMargin });
  }
};

export const RevealOutlineRow = Command.define("RevealOutlineRow", {
  args: { id: Schema.String },
  execute: ({ id }) =>
    Effect.sync(() => {
      revealOutlineRow(id);

      return Message.CompletedRevealOutlineRow();
    }),
  messages: [Message.CompletedRevealOutlineRow],
});
