import type { LearnEvent, LearnerProgressError } from "@rat-stack/core/learn";
import { Context } from "effect";
import type { Effect } from "effect";

export class LearnEventWriter extends Context.Service<
  LearnEventWriter,
  {
    readonly append: (
      event: LearnEvent
    ) => Effect.Effect<void, LearnerProgressError>;
  }
>()("@rat-stack/learn/LearnEventWriter") {}
