import { Effect } from "effect";
import { Runtime } from "foldkit";

import { installOverlay } from "#devtools-overlay";

import { initWithFlags, update, view } from "../features/app.js";
import { featuredFlags, Flags } from "./featured.js";
import { Message, Model } from "./model.js";
import { DocumentQueries } from "./queries.js";

import "@rat-stack/mischief/rat.css";
import "../styles.css";

const application = Runtime.makeApplication({
  Flags,
  Model,
  container: document.querySelector("#root"),
  devTools: import.meta.env.DEV ? { Message } : false,
  init: initWithFlags,
  resources: DocumentQueries.layer,
  routing: {
    onUrlChange: (url) => Message.ChangedUrl({ url }),
    onUrlRequest: (request) => Message.ClickedLink({ request }),
  },
  update,
  view,
});

installOverlay();

if (document.querySelector("[data-foldkit-app]") === null) {
  Runtime.run(application, { flags: Effect.succeed(featuredFlags) });
} else {
  Runtime.hydrate(application);
}
