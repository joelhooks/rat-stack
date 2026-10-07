import { Context } from "effect";
import type { Effect } from "effect";

import type {
  LearnContext,
  LearnEvent,
  LearnSelection,
  Progress,
} from "./learn-model.js";
import type { LearnerProgressError } from "./learner-progress-error.js";

export { LearnerProgressError } from "./learner-progress-error.js";

export class LearnerProgress extends Context.Service<
  LearnerProgress,
  {
    readonly next: (
      context: LearnContext
    ) => Effect.Effect<LearnSelection, LearnerProgressError>;
    readonly record: (
      event: LearnEvent
    ) => Effect.Effect<Progress, LearnerProgressError>;
    readonly read: Effect.Effect<Progress, LearnerProgressError>;
  }
>()("@rat-stack/core/LearnerProgress") {}
