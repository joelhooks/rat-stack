import { Dom, Runtime, Subscription } from "foldkit";

import { init, update, view } from "../features/overlay/overlay.js";
import { Message } from "./message.js";
import type { InspectorMessage } from "./message.js";
import { Model } from "./model.js";
import type { InspectorModel } from "./model.js";

import "../features/overlay/overlay.css";

const subscriptions = Subscription.make<InspectorModel, InspectorMessage>()(
  () => ({
    keyboard: Subscription.persistentEntry(
      Dom.streamFromKeyBindings<InspectorMessage>({
        bindings: [
          {
            keys: "Mod+K",
            mapEvent: () => Message.Toggled(),
            whileTyping: "Allow",
          },
          {
            keys: "Escape",
            mapEvent: () => Message.Closed(),
            whileTyping: "Allow",
          },
        ],
      })
    ),
  })
);

export const installOverlay = () => {
  const container = document.createElement("div");
  container.id = "rat-inspector";
  document.body.append(container);
  Runtime.run(
    Runtime.makeElement({ Model, container, init, subscriptions, update, view })
  );
};
