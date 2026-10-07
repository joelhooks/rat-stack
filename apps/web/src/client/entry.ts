import { Runtime } from "foldkit";
import { defineMessageUnion } from "foldkit/message";

import { installOverlay } from "#devtools-overlay";

import { readerView } from "../features/reader.js";
import { ReaderFlags, readerInit } from "./reader-model.js";

import "../../../mischief/src/rat.css";
import "./reader.css";

const Message = defineMessageUnion({ Noop: {} });

const application = Runtime.makeApplication({
  Flags: ReaderFlags,
  Model: ReaderFlags,
  container: document.querySelector("#root"),
  devTools: import.meta.env.DEV ? { Message } : false,
  init: readerInit,
  update: (model, _message: typeof Message.Type) => ({ model }),
  view: readerView,
});

installOverlay();

Runtime.hydrate(application);
