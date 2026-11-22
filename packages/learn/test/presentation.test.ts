import { expect, it } from "@effect/vitest";
import { CardSchema, newConcept } from "@rat-stack/core/learn";
import { Effect } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { learnCard, learnNext } from "../src/capabilities.js";
import { Learner } from "../src/learner.js";
import { LONG_GAP_MS } from "../src/progress.js";

it.effect.prop(
  "both learning tools reveal progressively more of a card without rewriting the source",
  { source: Arbitrary.schema(CardSchema) },
  ({ source }) => {
    const card = { ...source, prerequisites: [] };

    return Effect.gen(function* compareDepths() {
      const { id } = card;

      const line = yield* learnCard.handler({ depth: "line", id });
      const paragraph = yield* learnCard.handler({ depth: "paragraph", id });

      const walkthrough = yield* learnCard.handler({
        depth: "walkthrough",
        id,
      });

      expect(line.card).toMatchObject({
        claim: card.claim,
        id,
        kind: card.kind,
        references: card.references,
        routePath: card.routePath,
        version: card.version,
      });

      if (card.plain === undefined) {
        expect(line.card).toHaveProperty("summary", card.summary);
        expect(line.card).not.toHaveProperty("plain");
      } else {
        expect(line.card).toHaveProperty("plain", card.plain);
        expect(line.card).not.toHaveProperty("summary");
      }

      expect(line.card).not.toHaveProperty("terms");
      expect(line.card).not.toHaveProperty("prerequisites");
      expect(paragraph.card).toMatchObject({
        ...line.card,
        prerequisites: card.prerequisites,
        summary: card.summary,
        terms: card.terms,
      });
      expect(Object.keys(line.card).length).toBeLessThan(
        Object.keys(paragraph.card).length
      );
      expect(paragraph.card).not.toHaveProperty("diagram");
      expect(paragraph.card).not.toHaveProperty("snippet");
      expect(walkthrough.card).toMatchObject(paragraph.card);
      expect(JSON.stringify(walkthrough)).toBe(
        JSON.stringify({ card, depth: "walkthrough" })
      );

      const introduced = {
        ...newConcept(id),
        familiarity: 1,
        lastShownAt: 0,
      } as const;

      for (const [at, concepts, expected] of [
        [0, [], walkthrough],
        [1, [introduced], line],
        [LONG_GAP_MS, [introduced], paragraph],
      ] as const) {
        const selected = yield* learnNext.handler({
          context: { at, ids: [id] },
          progress: { concepts, version: 1 },
        });

        expect(selected.cards).toStrictEqual([expected]);
      }
    }).pipe(Effect.provide(Learner.layer(Effect.succeed([card]))));
  }
);
