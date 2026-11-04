import { Dom, Subscription } from "foldkit";

import * as MotionDemo from "../motion/index.js";
import { Message } from "./message.js";
import type { ReaderMessage } from "./message.js";
import type { ReaderModel } from "./model.js";

const motion = Subscription.lift(MotionDemo.subscriptions)<
  ReaderModel,
  ReaderMessage
>({
  read: (model) => model.motion,
  toParentMessage: (message) => Message.GotMotionMessage({ message }),
});

const keyboard = Subscription.make<ReaderModel, ReaderMessage>()(() => ({
  escape: Subscription.persistentEntry(
    Dom.streamFromKeyBindings<ReaderMessage>({
      bindings: [
        {
          keys: "Escape",
          mapEvent: () => Message.PressedEscape(),
          whileTyping: "Allow",
        },
      ],
    })
  ),
}));

export const subscriptions = { ...motion, ...keyboard };
