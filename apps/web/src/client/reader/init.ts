import { Option } from "effect";
import { Update } from "foldkit";
import type { ApplicationInit } from "foldkit/runtime";

import { boot as bootDocs } from "../../features/app.js";
import type { DocumentQueries } from "../docs/queries.js";
import { DetectClipboard } from "./command.js";
import { Message } from "./message.js";
import type { ReaderMessage } from "./message.js";
import { initialModel } from "./model.js";
import type { ReaderModel, ReaderPageFlags } from "./model.js";

export const init: ApplicationInit<
  ReaderModel,
  ReaderMessage,
  ReaderPageFlags
> = (flags) => ({ model: initialModel(flags) });

export const browserInit: ApplicationInit<
  ReaderModel,
  ReaderMessage,
  ReaderPageFlags,
  DocumentQueries
> = (flags) => {
  const model = initialModel(flags);

  if (Option.isNone(model.docs)) {
    return { commands: [DetectClipboard()], model };
  }

  const booted = Update.foldChildInit(
    { ...bootDocs, model: model.docs.value },
    {
      toParentMessage: (message) => Message.GotDocsMessage({ message }),
      toParentModel: (docs) => ({ ...model, docs: Option.some(docs) }),
    }
  );

  return {
    commands: [DetectClipboard(), ...(booted.commands ?? [])],
    model: booted.model,
  };
};
