import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  discoverCatalog,
  namespaceOf,
  searchCatalog,
  toCatalog,
  toTypeScript,
  typeOf,
} from "../src/catalog.js";
import { echo, greet, mixed } from "./fixtures.js";

const catalog = toCatalog([echo, greet, mixed]);

const counts = Arbitrary.schema(
  Schema.Array(
    Schema.Int.check(Schema.isBetween({ maximum: 4, minimum: 1 }))
  ).check(Schema.isMinLength(1), Schema.isMaxLength(4))
);

const groupedCatalog = (sizes: readonly number[]) => {
  const [entry] = toCatalog([echo]).capabilities;

  if (entry === undefined) {
    throw new Error("Echo fixture must have a catalog entry");
  }

  return {
    capabilities: sizes.flatMap((size, namespace) =>
      Array.from({ length: size }, (_, index) => ({
        ...entry,
        name: `namespace${namespace}.tool${index}`,
      }))
    ),
    version: "1" as const,
  };
};

describe("budgeted discovery", () => {
  it.prop(
    "a full budget lists all signatures and zero lists only namespaces",
    { sizes: counts },
    ({ sizes }) => {
      const generated = groupedCatalog(sizes);
      const full = discoverCatalog(generated, Number.MAX_SAFE_INTEGER);
      const empty = discoverCatalog(generated, 0);
      expect(full.selected).toHaveLength(generated.capabilities.length);
      expect(full.complete).toBe(true);
      expect(empty.selected).toHaveLength(0);
      expect(empty.declarations).toBe("");

      for (const entry of generated.capabilities) {
        expect(full.declarations).toContain(`readonly "${entry.name}":`);
        expect(empty.summary).toContain(namespaceOf(entry.name));
      }
    }
  );

  it.prop(
    "round robin represents every affordable namespace before repeating one",
    { sizes: counts },
    ({ sizes }) => {
      const generated = groupedCatalog(sizes);

      const oneCost =
        toTypeScript({
          capabilities: generated.capabilities.slice(0, 1),
          version: "1",
        }).length / 4;

      const firstRound = discoverCatalog(generated, oneCost * sizes.length);
      expect(firstRound.selected).toHaveLength(sizes.length);
      expect(
        new Set(firstRound.selected.map((entry) => namespaceOf(entry.name)))
          .size
      ).toBe(sizes.length);
    }
  );

  it.prop(
    "selected signatures never exceed their estimated token budget",
    {
      budget: Arbitrary.schema(
        Schema.Int.check(Schema.isBetween({ maximum: 3000, minimum: 0 }))
      ),
      sizes: counts,
    },
    ({ budget, sizes }) => {
      const selection = discoverCatalog(groupedCatalog(sizes), budget);

      const actual = selection.selected.reduce(
        (sum, entry) =>
          sum +
          toTypeScript({ capabilities: [entry], version: "1" }).length / 4,
        0
      );

      expect(actual).toBeLessThanOrEqual(budget);
      expect(selection.used).toBe(actual);
    }
  );
});

describe("toCatalog", () => {
  it("records every capability with JSON Schema for each channel", () => {
    expect(catalog.version).toBe("1");
    expect(catalog.capabilities.map((entry) => entry.name)).toEqual([
      "echo",
      "greet",
      "mixed",
    ]);
    const [, greetEntry] = catalog.capabilities;
    expect(greetEntry?.input).toMatchObject({
      properties: { name: { type: "string" } },
      required: ["name"],
      type: "object",
    });
    expect(greetEntry?.failure).toMatchObject({
      $ref: "#/$defs/NotFoundEncoded",
    });
  });
});

describe("typeOf", () => {
  it("prints the JSON Schema shapes Effect emits", () => {
    expect(typeOf({ enum: ["fast", "slow"], type: "string" })).toBe(
      '"fast" | "slow"'
    );
    expect(typeOf({ anyOf: [{ type: "number" }, { type: "null" }] })).toBe(
      "number | null"
    );
    expect(typeOf({ items: { type: "string" }, type: "array" })).toBe(
      "ReadonlyArray<string>"
    );
    expect(typeOf({ not: {} })).toBe("never");
    expect(typeOf({ $ref: "#/$defs/NotFoundEncoded" })).toBe("NotFoundEncoded");
    expect(typeOf({ type: 7 })).toBe("unknown");
  });
});

describe("toTypeScript", () => {
  it("declares named failures and a tools object with doc comments", () => {
    const declarations = toTypeScript(catalog);

    expect(declarations).toContain(
      'type NotFoundEncoded = { readonly _tag: "NotFound"; readonly name: string };'
    );
    expect(declarations).toContain("declare const tools: {");
    expect(declarations).toContain(
      "readonly greet: (input: { readonly name: string }) => Promise<{ readonly greeting: string }>;"
    );
    expect(declarations).toContain("@throws NotFoundEncoded");
    expect(declarations).toContain("Read-only.");
    expect(declarations).toContain(
      "readonly text: string; readonly times?: number | null"
    );
  });
});

describe("searchCatalog", () => {
  it.prop(
    "ranking is stable under catalog permutations and pages cover every match once",
    {
      pageSize: Arbitrary.schema(
        Schema.Int.check(Schema.isBetween({ maximum: 5, minimum: 1 }))
      ),
      sizes: counts,
    },
    ({ pageSize, sizes }) => {
      const generated = groupedCatalog(sizes);
      const all = searchCatalog(generated, "tool", Number.MAX_SAFE_INTEGER);

      const reversed = searchCatalog(
        { ...generated, capabilities: generated.capabilities.toReversed() },
        "tool",
        Number.MAX_SAFE_INTEGER
      );

      const pages = Array.from(
        { length: Math.ceil(all.length / pageSize) },
        (_, index) =>
          searchCatalog(generated, "tool", pageSize, index * pageSize)
      ).flat();

      expect(reversed).toEqual(all);
      expect(pages).toEqual(all);
      expect(new Set(pages.map((match) => match.name)).size).toBe(
        generated.capabilities.length
      );
    }
  );

  it.prop(
    "an exact path query isolates its tool regardless of competing descriptions",
    { sizes: counts },
    ({ sizes }) => {
      const generated = groupedCatalog(sizes);

      for (const entry of generated.capabilities) {
        for (const query of [
          entry.name,
          `tools.${entry.name}`,
          `tools[${JSON.stringify(entry.name)}]`,
        ]) {
          expect(
            searchCatalog(generated, query).map((match) => match.name)
          ).toEqual([entry.name]);
        }
      }
    }
  );

  it.prop(
    "path segment, path substring, description and input description have decreasing weights",
    {
      id: Arbitrary.schema(
        Schema.Natural.check(Schema.isLessThanOrEqualTo(100))
      ),
    },
    ({ id }) => {
      const [seed] = catalog.capabilities;

      if (seed === undefined) {
        throw new Error("Catalog fixture must have an entry");
      }

      const word = `ticket${id}`;

      const generated = {
        capabilities: [
          { ...seed, description: "", input: {}, name: `root.${word}` },
          { ...seed, description: "", input: {}, name: `root.${word}ing` },
          { ...seed, description: word, input: {}, name: "root.summary" },
          {
            ...seed,
            description: "",
            input: {
              properties: { value: { description: word, type: "string" } },
              type: "object",
            },
            name: "root.last",
          },
        ],
        version: "1" as const,
      };

      expect(searchCatalog(generated, word).map((match) => match.name)).toEqual(
        generated.capabilities.map((entry) => entry.name)
      );
    }
  );

  it("ranks by name, then description and input overlap", () => {
    const matches = searchCatalog(catalog, "greet someone by name");

    expect(matches[0]?.name).toBe("greet");
    expect(matches[0]?.signature).toContain("readonly greet:");
    expect(matches.every((match) => match.score > 0)).toBe(true);
  });

  it("returns everything for an empty query, within the limit", () => {
    expect(searchCatalog(catalog, "", 2)).toHaveLength(2);
    expect(searchCatalog(catalog, "")).toHaveLength(3);
  });

  it("returns nothing when no token matches", () => {
    expect(searchCatalog(catalog, "zebra")).toHaveLength(0);
  });
});
