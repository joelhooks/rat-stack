import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { deriveDeck, InvalidLearnDeck } from "../src/deck-build.js";
import type { CardSource } from "../src/deck-build.js";

const summary = Arbitrary.schema(Schema.String.check(Schema.isMaxLength(400)));

const source = (description: string): CardSource => ({
  description,
  id: "lore.layers",
  kind: "lore",
  prerequisites: [],
  routePath: "/lore/layers",
  sources: ["https://effect.website/docs/requirements-management/layers/"],
  terms: ["Layer"],
  title: "Layers build services",
});

it.prop(
  "derived cards preserve source text without summarization",
  { summary },
  ({ summary: description }) => {
    if (description.trim() === "") {
      return;
    }

    const result = deriveDeck([source(description)]);
    expect(result.cards[0]?.summary).toBe(description);
    expect(result.cards[0]?.claim).toBe("Layers build services");
  }
);

it("accumulates independent defects across cards and resolves explicit page prerequisites", () => {
  const first = {
    ...source(""),
    prerequisites: ["lore.missing"],
    routePath: "",
    sources: [],
  };

  const second = {
    ...source("Second."),
    id: "lore.second",
    prerequisites: ["lore.absent"],
    sources: [],
  };

  try {
    deriveDeck([first, second]);
    expect.fail("invalid cards must stop asset generation");
  } catch (error) {
    const failure = Schema.decodeUnknownSync(InvalidLearnDeck)(error);
    expect(
      failure.errors.filter((entry) => entry.id === first.id).length
    ).toBeGreaterThanOrEqual(4);
    expect(
      failure.errors.filter((entry) => entry.id === second.id).length
    ).toBeGreaterThanOrEqual(2);
  }

  const valid = deriveDeck([
    source("First."),
    {
      ...source("Second."),
      id: "skill.layers",
      kind: "skill",
      prerequisites: ["/lore/layers"],
      routePath: "/skills/layers",
      sources: [],
      terms: [],
    },
  ]);

  expect(valid.cards[1]?.prerequisites).toStrictEqual(["lore.layers"]);
  expect(valid.cards[1]?.references).toStrictEqual([
    "https://ratstack.sh/skills/layers",
  ]);
  expect(valid.warnings.some((entry) => entry.id === "skill.layers")).toBe(
    true
  );
});

const teaching = Arbitrary.array(
  Arbitrary.schema(
    Schema.Struct({ broken: Schema.Boolean, taught: Schema.Boolean })
  ),
  { maxLength: 8, minLength: 1 }
);

it.prop(
  "every snippet compile failure is collected, and missing teaching fields only lower coverage",
  { teaching },
  ({ teaching: pages }) => {
    const sources = pages.map(({ broken, taught }, index) => ({
      ...source("Summary."),
      diagram: taught || broken ? "a\n│\nb" : undefined,
      id: `lore.concept-${index}`,
      plain: taught || broken ? "One line." : undefined,
      routePath: `/lore/concept-${index}`,
      snippet: taught || broken ? "export {};" : undefined,
      snippetDiagnostics: broken
        ? ["1:1 TS2322: Type 'string' is not assignable."]
        : undefined,
    }));

    const broken = pages.filter((page) => page.broken).length;

    try {
      const { cards, coverage } = deriveDeck(sources);
      const taught = pages.filter((page) => page.taught).length;

      expect(broken).toBe(0);
      expect(coverage.snippet).toBe(taught);
      expect(coverage.missing).toHaveLength(pages.length - taught);
      expect(cards.filter((card) => card.snippet !== undefined)).toHaveLength(
        taught
      );
    } catch (error) {
      const failure = Schema.decodeUnknownSync(InvalidLearnDeck)(error);

      expect(
        failure.errors.filter((entry) => entry.reason.startsWith("Snippet"))
      ).toHaveLength(broken);
    }
  }
);

it("rejects a snippet file that names no concept", () => {
  expect(() => deriveDeck([source("Summary.")], [], ["lore.ghost"])).toThrow(
    "lore.ghost: Snippet file names no concept"
  );
});
