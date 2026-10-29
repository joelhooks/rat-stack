import { LearnError } from "@rat-stack/core/learn";
import { Effect } from "effect";

import type * as FeedbackMachine from "./feedback-machine.js";

export const loadFeedbackMachine = (load: Promise<typeof FeedbackMachine>) =>
  Effect.tryPromise({
    catch: (cause) =>
      new LearnError({
        id: "feedback",
        reason: `Unable to load the feedback machine: ${String(cause)}`,
      }),
    try: load.finally.bind(load, undefined),
  });
