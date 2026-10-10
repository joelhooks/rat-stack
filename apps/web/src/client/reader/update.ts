import { Option, Record } from "effect";
import { Update } from "foldkit";
import { modifyFields } from "foldkit/struct";

import { update as updateDocs } from "../../features/app.js";
import * as Cafe from "../cafe/index.js";
import type { AppMessage as DocsMessage } from "../docs/message.js";
import type { AppModel as DocsModel } from "../docs/model.js";
import type { DocumentQueries } from "../docs/queries.js";
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

const foldDocs = Update.foldChild({
  read: (model: ReaderModel) => model.docs,
  toParentMessage: (message: DocsMessage) =>
    Message.GotDocsMessage({ message }),
  update: updateDocs,
  write: (model: ReaderModel, docs: DocsModel) =>
    modifyFields(model, { docs: () => Option.some(docs) }),
});

export const update = (
  model: ReaderModel,
  message: ReaderMessage
): Update.Return<ReaderModel, ReaderMessage, DocumentQueries> =>
  Message.match<Update.Return<ReaderModel, ReaderMessage, DocumentQueries>>(
    message,
    {
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
      GotCafeMessage: ({ message: cafeMessage }) =>
        foldCafe(model, cafeMessage),
      GotDocsMessage: ({ message: docsMessage }) =>
        foldDocs(model, docsMessage),
      SucceededCopyReaderText: ({ id }) =>
        CopyStatus.guards.Copying(copyStatusOf(model, id))
          ? {
              commands: [WaitBeforeCopyReset({ id })],
              model: withCopyStatus(model, id, CopyStatus.Copied()),
            }
          : { model },
    }
  );
