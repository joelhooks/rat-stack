import { Runtime } from "foldkit";

import { installOverlay } from "#devtools-overlay";

import { view } from "../features/reader.js";
import { browserInit } from "./reader/init.js";
import { Message } from "./reader/message.js";
import { Model, ReaderFlags } from "./reader/model.js";
import { update } from "./reader/update.js";

import "../../../mischief/src/rat.css";
import "./reader.css";

const application = Runtime.makeApplication({
  Flags: ReaderFlags,
  Model,
  container: document.querySelector("#root"),
  devTools: import.meta.env.DEV ? { Message } : false,
  init: browserInit,
  update,
  view,
});

installOverlay();

Runtime.hydrate(application);
