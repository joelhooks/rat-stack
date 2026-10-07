import { Match } from "effect";

import { CopyReaderText, ExpireCopyStatus } from "./reader-clipboard.js";
import type { ReaderMessage } from "./reader-message.js";
import type { CopyStatus, ReaderModel } from "./reader-model.js";

const withCopyStatus = (
  model: ReaderModel,
  id: string,
  status: typeof CopyStatus.Type
): ReaderModel => ({
  ...model,
  copyStates: { ...model.copyStates, [id]: status },
});

export const readerUpdate = (
  model: ReaderModel,
  message: typeof ReaderMessage.Type
) =>
  Match.value(message).pipe(
    Match.tagsExhaustive({
      ClipboardReady: ({ available }) => ({
        model: { ...model, clipboardReady: available },
      }),
      CopyFailed: ({ id }) => ({
        model:
          model.copyStates[id] === "copying"
            ? withCopyStatus(model, id, "failed")
            : model,
      }),
      CopyRequested: ({ id }) => {
        const prompt = model.copyPrompts.find((entry) => entry.id === id);

        if (
          !model.clipboardReady ||
          prompt === undefined ||
          model.copyStates[id] === "copying" ||
          model.copyStates[id] === "copied"
        ) {
          return { model };
        }

        return {
          commands: [CopyReaderText({ id, text: prompt.text })],
          model: withCopyStatus(model, id, "copying"),
        };
      },
      CopyStatusExpired: ({ id }) => ({
        model:
          model.copyStates[id] === "copied"
            ? withCopyStatus(model, id, "idle")
            : model,
      }),
      CopySucceeded: ({ id }) => {
        if (model.copyStates[id] !== "copying") {
          return { model };
        }

        return {
          commands: [ExpireCopyStatus({ id })],
          model: withCopyStatus(model, id, "copied"),
        };
      },
    })
  );
