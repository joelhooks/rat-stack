import type {
  Card,
  LearnContext,
  LearnEvent,
  LearnSelection,
  Progress,
} from "@rat-stack/core/learn";
import { LearnError, newConcept } from "@rat-stack/core/learn";
import { Context, Effect, Exit, Layer } from "effect";

import { evaluateConcept } from "./evaluate-concept.js";
import { recordConcept } from "./progress-machine.js";
import { mergeProgress } from "./progress.js";

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
      Effect.gen(function* makeLearner() {
        const cards = yield* Effect.cachedWithTTL(deck, (exit) =>
          Exit.isSuccess(exit) ? "Infinity" : 0
        );

        const card = Effect.fn("Learner.card")(function* findCard(id: string) {
          const found = (yield* cards).find((item) => item.id === id);

          if (found === undefined) {
            return yield* new LearnError({
              id,
              reason: "Unknown concept id; call learnDeck for valid ids.",
            });
          }

          return found;
        });

        const record = Effect.fn("Learner.record")(function* record(
          progress: Progress,
          event: LearnEvent
        ) {
          yield* card(event.id);

          for (const concept of progress.concepts) {
            yield* card(concept.id);
          }

          const normalized = mergeProgress(progress, {
            concepts: [],
            version: 1,
          });

          const before =
            normalized.concepts.find((item) => item.id === event.id) ??
            newConcept(event.id);

          const updated = yield* recordConcept(before, event);

          return {
            concepts: [
              ...normalized.concepts.filter((item) => item.id !== event.id),
              updated,
            ].toSorted((a, b) => a.id.localeCompare(b.id)),
            version: 1,
          } satisfies Progress;
        });

        const next = Effect.fn("Learner.next")(function* next(
          progress: Progress,
          context: LearnContext
        ) {
          for (const concept of progress.concepts) {
            yield* card(concept.id);
          }

          const normalized = mergeProgress(progress, {
            concepts: [],
            version: 1,
          });

          const presentations: LearnSelection["cards"][number][] = [];

          for (const id of new Set(context.ids)) {
            const found = yield* card(id);

            const before =
              normalized.concepts.find((item) => item.id === id) ??
              newConcept(id);

            const depth = yield* evaluateConcept(
              before,
              context.at,
              context.asked ?? false
            );

            if (depth !== null) {
              presentations.push({ card: found, depth });
            }
          }

          return { cards: presentations, progress: normalized };
        });

        return Learner.of({ card, deck: cards, next, record });
      })
    );
}
