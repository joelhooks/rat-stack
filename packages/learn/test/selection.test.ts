import { expect, it } from "@effect/vitest";
import type { Progress } from "@rat-stack/core/learn";
import { emptyProgress } from "@rat-stack/core/learn";
import { Effect } from "effect";

import { learnNext } from "../src/capabilities.js";
import { Learner } from "../src/learner.js";
import { graph, makeDeck } from "./selection-fixture.js";

it.effect.prop(
  "fresh progress offers a path root before a dependent, regardless of deck order or explicit context",
  { graph },
  ({ graph: { branch, length } }) =>
    Effect.gen(function* selectRoot() {
      const learner = yield* Learner;

      const defaultSelection = yield* learnNext.handler({
        progress: emptyProgress,
      });

      const explicit = yield* learner.next(emptyProgress, {
        at: 0,
        ids: [`lore.concept-${length - 1}`],
      });

      for (const selection of [defaultSelection, explicit]) {
        expect(selection.cards).toHaveLength(1);
        expect(selection.cards[0]?.card.id).toBe("lore.concept-0");
        expect(selection.cards[0]?.card.prerequisites).toStrictEqual([]);
        expect(selection.cards[0]?.depth).toBe("walkthrough");
        expect(selection.progress).toStrictEqual(emptyProgress);
      }
    }).pipe(
      Effect.provide(
        Learner.layer(Effect.succeed(makeDeck(length, branch).toReversed()))
      )
    )
);

it.effect.prop(
  "default walkthroughs advance only after each prerequisite is introduced",
  { graph },
  ({ graph: { branch, length } }) =>
    Effect.gen(function* followPrerequisites() {
      const learner = yield* Learner;
      let progress: Progress = emptyProgress;

      for (let index = 0; index < length; index += 1) {
        const selection = yield* learner.next(progress, { at: index, ids: [] });
        const [presented] = selection.cards;
        expect(presented).toBeDefined();
        expect(presented?.card.id).toBe(`lore.concept-${index}`);

        for (const prerequisite of presented?.card.prerequisites ?? []) {
          expect(
            progress.concepts.find((item) => item.id === prerequisite)
              ?.familiarity
          ).toBeGreaterThan(0);
        }

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
        Learner.layer(Effect.succeed(makeDeck(length, branch).toReversed()))
      )
    )
);
