import type {
  Card,
  LearnContext,
  LearnError,
  LearnEvent,
  LearnSelection,
  Progress,
} from "@rat-stack/core/learn";
import { Context, Effect, Layer, Option, Ref } from "effect";

import { loadLearnerImplementation } from "./learner-loader.js";

export class Learner extends Context.Service<
  Learner,
  {
    readonly deck: Effect.Effect<readonly Card[], LearnError>;
    readonly card: (id: string) => Effect.Effect<Card, LearnError>;
    readonly next: (
      progress: Progress,
      context: LearnContext
    ) => Effect.Effect<LearnSelection, LearnError>;
    readonly record: (
      progress: Progress,
      event: LearnEvent
    ) => Effect.Effect<Progress, LearnError>;
  }
>()("@rat-stack/learn/Learner") {
  static readonly layer = (deck: Effect.Effect<readonly Card[], LearnError>) =>
    Layer.effect(
      Learner,
      Effect.gen(function* makeLazyLearner() {
        const completed = yield* Ref.make<Option.Option<Learner["Service"]>>(
          Option.none()
        );

        const service = Effect.gen(function* loadLearnerOnRequest() {
          const cached = yield* Ref.get(completed);

          if (Option.isSome(cached)) {
            return cached.value;
          }

          const pending = import("./learner-service.js");
          const implementation = yield* loadLearnerImplementation(pending);

          const loaded = yield* implementation.makeLearner(deck);
          yield* Ref.set(completed, Option.some(loaded));

          return loaded;
        });

        return Learner.of({
          card: (id) =>
            service.pipe(Effect.flatMap((learner) => learner.card(id))),
          deck: service.pipe(Effect.flatMap((learner) => learner.deck)),
          next: (progress, context) =>
            service.pipe(
              Effect.flatMap((learner) => learner.next(progress, context))
            ),
          record: (progress, event) =>
            service.pipe(
              Effect.flatMap((learner) => learner.record(progress, event))
            ),
        });
      })
    );
}
