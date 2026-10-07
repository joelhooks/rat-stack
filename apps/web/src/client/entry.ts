import { Runtime } from "foldkit";

import { installOverlay } from "#devtools-overlay";

import { readerView } from "../features/reader.js";
import { readerBrowserInit } from "./reader-init.js";
import { ReaderMessage } from "./reader-message.js";
import { ReaderFlags, ReaderState } from "./reader-model.js";
import { readerUpdate } from "./reader-update.js";

import "../../../mischief/src/rat.css";
import "./reader.css";

const application = Runtime.makeApplication({
  Flags: ReaderFlags,
  Model: ReaderState,
  container: document.querySelector("#root"),
  devTools: import.meta.env.DEV ? { Message: ReaderMessage } : false,
  init: readerBrowserInit,
  update: readerUpdate,
  view: readerView,
});

installOverlay();

Runtime.hydrate(application);
