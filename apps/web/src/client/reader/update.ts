import { Option, Record } from "effect";
import { Update } from "foldkit";
import { modifyFields } from "foldkit/struct";

import * as Cafe from "../cafe/index.js";
import { CopyReaderText, WaitBeforeCopyReset } from "./command.js";
import { Message } from "./message.js";
import type { ReaderMessage } from "./message.js";
import {
  ClipboardAccess,
  copyStatusOf,
  CopyStatus,
  findCopyPrompt,
} from "./model.js";
import type { ReaderModel } from "./model.js";

const withCopyStatus = (
  model: ReaderModel,
  id: string,
  status: typeof CopyStatus.Type
) => modifyFields(model, { copyStatuses: Record.set(id, status) });

const isCopyInFlight = CopyStatus.isAnyOf(["Copying", "Copied"]);

const copyablePrompt = (model: ReaderModel, id: string) =>
  ClipboardAccess.guards.Available(model.clipboardAccess) &&
  !isCopyInFlight(copyStatusOf(model, id))
    ? findCopyPrompt(model, id)
    : Option.none();

const foldCafe = Update.foldChild({
  read: (model: ReaderModel) => model.cafe,
  toParentMessage: (message: Cafe.CafeMessage) =>
    Message.GotCafeMessage({ message }),
  update: Cafe.update,
  write: (model: ReaderModel, cafe: Cafe.CafeModel) =>
    modifyFields(model, { cafe: () => Option.some(cafe) }),
});

export const update = (
  model: ReaderModel,
  message: ReaderMessage
): Update.Return<ReaderModel, ReaderMessage> =>
  Message.match<Update.Return<ReaderModel, ReaderMessage>>(message, {
    ClickedCopy: ({ id }) =>
      Option.match(copyablePrompt(model, id), {
        onNone: () => ({ model }),
        onSome: ({ text }) => ({
          commands: [CopyReaderText({ id, text })],
          model: withCopyStatus(model, id, CopyStatus.Copying()),
        }),
      }),
    CompletedDetectClipboard: ({ access }) => ({
      model: modifyFields(model, { clipboardAccess: () => access }),
    }),
    CompletedWaitBeforeCopyReset: ({ id }) => ({
      model: CopyStatus.guards.Copied(copyStatusOf(model, id))
        ? withCopyStatus(model, id, CopyStatus.Idle())
        : model,
    }),
    FailedCopyReaderText: ({ id }) => ({
      model: CopyStatus.guards.Copying(copyStatusOf(model, id))
        ? withCopyStatus(model, id, CopyStatus.Failed())
        : model,
    }),
    GotCafeMessage: ({ message: cafeMessage }) => foldCafe(model, cafeMessage),
    SucceededCopyReaderText: ({ id }) =>
      CopyStatus.guards.Copying(copyStatusOf(model, id))
        ? {
            commands: [WaitBeforeCopyReset({ id })],
            model: withCopyStatus(model, id, CopyStatus.Copied()),
          }
        : { model },
  });
