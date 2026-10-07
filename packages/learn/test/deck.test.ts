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
