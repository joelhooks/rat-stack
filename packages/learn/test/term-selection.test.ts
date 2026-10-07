import { expect, it } from "@effect/vitest";
import type { Progress } from "@rat-stack/core/learn";
import { emptyProgress } from "@rat-stack/core/learn";
import { Effect } from "effect";

import { Learner } from "../src/learner.js";
import { graph, makeDeck } from "./selection-fixture.js";

it.effect.prop(
  "a public term offers its owner or an unmet prerequisite, never an unrelated card",
  { graph },
  ({ graph: { branch, length, position } }) =>
    Effect.gen(function* matchTerm() {
      const learner = yield* Learner;
      const ownerIndex = position % length;
      let progress: Progress = emptyProgress;

      for (let index = 0; index <= ownerIndex; index += 1) {
        const selection = yield* learner.next(progress, {
          at: index,
          ids: [],
          terms: [`concept ${ownerIndex}`],
        });

        expect(selection.cards).toHaveLength(1);
        expect(selection.cards[0]?.card.id).toBe(`lore.concept-${index}`);

        progress = yield* learner.record(progress, {
          at: index,
          depth: "walkthrough",
          id: `lore.concept-${index}`,
          kind: "shown",
          version: 1,
        });
      }
    }).pipe(
      Effect.provide(
        Learner.layer(
          Effect.succeed([
            ...makeDeck(1, false).map((card) => ({
              ...card,
              id: "lore.unrelated",
              routePath: "/lore/unrelated",
              terms: ["outside"],
            })),
            ...makeDeck(length, branch).toReversed(),
          ])
        )
      )
    )
);

it.effect.prop(
  "dismissing any prefix leaves the next undismissed concept available",
  { graph },
  ({ graph: { branch, length, position } }) =>
    Effect.gen(function* dismissPrefix() {
      const learner = yield* Learner;
      const prefix = position % length;
      let progress: Progress = emptyProgress;

      for (let index = 0; index < prefix; index += 1) {
        progress = yield* learner.record(progress, {
          at: index,
          id: `lore.concept-${index}`,
          kind: "dismissed",
          version: 1,
        });
      }

      const selection = yield* learner.next(progress, { at: length, ids: [] });
      expect(selection.cards).toHaveLength(1);
      expect(selection.cards[0]?.card.id).toBe(`lore.concept-${prefix}`);
      expect(selection.cards[0]?.depth).toBe("walkthrough");
      expect(
        selection.cards.some(({ card }) =>
          progress.concepts.some(
            (item) => item.id === card.id && item.dismissed
          )
        )
      ).toBe(false);
    }).pipe(
      Effect.provide(
        Learner.layer(Effect.succeed(makeDeck(length, branch).toReversed()))
      )
    )
);
