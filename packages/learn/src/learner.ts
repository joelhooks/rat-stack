import type {
  Card,
  LearnContext,
  LearnEvent,
  LearnSelection,
  Progress,
} from "@rat-stack/core/learn";
import { LearnError, newConcept } from "@rat-stack/core/learn";
import { Context, Effect, Layer, Option, Ref } from "effect";

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
        const completed = yield* Ref.make<Option.Option<readonly Card[]>>(
          Option.none()
        );

        const cards = Effect.gen(function* readCompletedDeck() {
          const cached = yield* Ref.get(completed);

          if (Option.isSome(cached)) {
            return cached.value;
          }

          const loaded = yield* deck;
          yield* Ref.set(completed, Option.some(loaded));

          return loaded;
        });

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

          const known = new Map(
            normalized.concepts.map((item) => [item.id, item])
          );

          const resolve = Effect.fn("Learner.prerequisite")(function* resolve(
            found: Card,
            visited: ReadonlySet<string>
          ): Effect.fn.Return<Card | null, LearnError> {
            if (visited.has(found.id)) {
              return yield* new LearnError({
                id: found.id,
                reason:
                  "Cyclic prerequisites; repair the concept deck metadata.",
              });
            }

            for (const id of found.prerequisites) {
              const prerequisite = known.get(id);

              if (prerequisite?.dismissed === true) {
                continue;
              }

              if ((prerequisite?.familiarity ?? 0) === 0) {
                return yield* resolve(
                  yield* card(id),
                  new Set([...visited, found.id])
                );
              }
            }

            return found;
          });

          const available = yield* cards;
          const terms = context.terms ?? [];
          const termIds: string[] = [];

          for (const term of terms) {
            const owners = available.filter((item) =>
              item.terms.some(
                (candidate) =>
                  candidate.trim().toLowerCase() === term.trim().toLowerCase()
              )
            );

            const owner =
              owners.find((item) => item.kind !== "skill") ?? owners[0];

            if (owner === undefined) {
              return yield* new LearnError({
                id: "term",
                reason: "Unknown public term; call learnDeck for valid terms.",
              });
            }

            termIds.push(owner.id);
          }

          const requested = [...context.ids, ...termIds];
          const defaultSelection = requested.length === 0;

          const candidates = defaultSelection
            ? [
                ...available.filter(
                  (item) => (known.get(item.id)?.familiarity ?? 0) === 0
                ),
                ...available.filter(
                  (item) => (known.get(item.id)?.familiarity ?? 0) > 0
                ),
              ].map((item) => item.id)
            : requested;

          const offered = new Set<string>();

          for (const id of new Set(candidates)) {
            const found = yield* resolve(yield* card(id), new Set());

            if (found === null || offered.has(found.id)) {
              continue;
            }

            offered.add(found.id);
            const before = known.get(found.id) ?? newConcept(found.id);

            const depth = yield* evaluateConcept(
              before,
              context.at,
              context.asked ?? false
            );

            if (depth !== null) {
              presentations.push({ card: found, depth });

              if (defaultSelection) {
                break;
              }
            }
          }

          return { cards: presentations, progress: normalized };
        });

        return Learner.of({ card, deck: cards, next, record });
      })
    );
}
