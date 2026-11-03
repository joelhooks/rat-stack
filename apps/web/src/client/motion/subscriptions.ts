import * as Motion from "@rat-stack/motion/foldkit";

import { Message } from "./message.js";
import type { MotionDemoMessage } from "./message.js";
import type { MotionDemoModel } from "./model.js";
import { isAnimating } from "./update.js";

export const subscriptions = Motion.motionSubscriptions<
  MotionDemoModel,
  MotionDemoMessage
>({
  isAnimating,
  toMessage: (message) => Message.GotMotionMessage({ message }),
});
