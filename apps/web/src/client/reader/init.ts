import { Option } from "effect";
import { Update } from "foldkit";
import type { ApplicationInit } from "foldkit/runtime";

import { boot as bootDocs } from "../../features/app.js";
import type { DocumentQueries } from "../docs/queries.js";
import { DetectClipboard } from "./command.js";
import { Message } from "./message.js";
import type { ReaderMessage } from "./message.js";
import { initialModel, Menu, SettingsPanel } from "./model.js";
import type { ReaderModel, ReaderPageFlags } from "./model.js";
import { LoadSettings } from "./settings-command.js";

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
  const model = {
    ...initialModel(flags),
    menu: Menu.Closed(),
    settingsPanel: SettingsPanel.Closed(),
  };

  if (Option.isNone(model.docs)) {
    return { commands: [DetectClipboard(), LoadSettings()], model };
  }

  const booted = Update.foldChildInit(
    { ...bootDocs, model: model.docs.value },
    {
      toParentMessage: (message) => Message.GotDocsMessage({ message }),
      toParentModel: (docs) => ({ ...model, docs: Option.some(docs) }),
    }
  );

  return {
    commands: [DetectClipboard(), LoadSettings(), ...(booted.commands ?? [])],
    model: booted.model,
  };
};
