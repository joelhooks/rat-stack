import { LearnError } from "@rat-stack/core/learn";
import { Effect } from "effect";

import type * as LearnerImplementation from "./learner-service.js";

export const loadLearnerImplementation = (
  load: Promise<typeof LearnerImplementation>
) =>
  Effect.tryPromise({
    catch: (cause) =>
      new LearnError({
        id: "learner",
        reason: `Unable to load the learner implementation: ${String(cause)}`,
      }),
    try: load.finally.bind(load, undefined),
  });
