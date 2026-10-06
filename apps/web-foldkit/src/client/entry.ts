import { Runtime } from "foldkit";

import { init, update, view } from "../features/app.js";
import { Message, Model } from "./model.js";

import "./styles.css";

const application = Runtime.makeApplication({
  Model,
  container: document.querySelector("#root"),
  devTools: import.meta.env.DEV ? { Message } : false,
  init,
  routing: {
    onUrlChange: (url) => Message.ChangedUrl({ url }),
    onUrlRequest: (request) => Message.ClickedLink({ request }),
  },
  update,
  view,
});

if (document.querySelector("[data-foldkit-app]") === null) {
  Runtime.run(application);
} else {
  Runtime.hydrate(application);
}
