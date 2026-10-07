import type { Card } from "@rat-stack/core/learn";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

export const graph = Arbitrary.schema(
  Schema.Struct({
    branch: Schema.Boolean,
    length: Schema.Int.check(Schema.isBetween({ maximum: 9, minimum: 2 })),
    position: Schema.Int.check(Schema.isBetween({ maximum: 8, minimum: 0 })),
  })
);

export const makeDeck = (length: number, branch: boolean): readonly Card[] =>
  Array.from({ length }, (_, index) => ({
    claim: `Concept ${index}`,
    id: `lore.concept-${index}`,
    kind: "lore",
    prerequisites:
      index === 0
        ? []
        : [
            `lore.concept-${index - 1}`,
            ...(branch && index > 1 ? ["lore.concept-0"] : []),
          ],
    references: ["https://example.com/source"],
    routePath: `/lore/concept-${index}`,
    summary: "A supplied service.",
    terms: [`concept ${index}`],
    version: 1,
  }));
