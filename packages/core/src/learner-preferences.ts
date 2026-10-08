import { Context } from "effect";
import type { Effect } from "effect";

import type {
  LearnPreferences,
  LearnPreferencesChange,
} from "./learn-model.js";
import type { LearnerProgressError } from "./learner-progress-error.js";

export class LearnerPreferences extends Context.Service<
  LearnerPreferences,
  {
    readonly read: Effect.Effect<LearnPreferences, LearnerProgressError>;
    readonly update: (
      change: LearnPreferencesChange
    ) => Effect.Effect<LearnPreferences, LearnerProgressError>;
  }
>()("@rat-stack/core/LearnerPreferences") {}
