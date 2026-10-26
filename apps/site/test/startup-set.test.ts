import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";

import {
  assertStartupBudget,
  measureStartupSet,
} from "../scripts/startup-set.ts";

const bytes = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ maximum: 10_000, minimum: 1 }))
);

it.effect.prop(
  "counts transitive static imports once across cycles, diamonds and dynamic edges",
  {
    sizes: Arbitrary.schema(
      Schema.Array(
        Schema.Int.check(Schema.isBetween({ maximum: 10_000, minimum: 1 }))
      ).check(Schema.isMinLength(4), Schema.isMaxLength(4))
    ),
  },
  ({ sizes }) =>
    Effect.gen(function* staticClosure() {
      const files = sizes.map((size, index) => ({
        bytes: size,
        path: `${index}.js`,
      }));

      const graph = {
        chunks: [
          {
            imports: [
              { targetChunkIndex: 1, type: "static" as const },
              { targetChunkIndex: 2, type: "static" as const },
              { targetChunkIndex: 3, type: "dynamic" as const },
            ],
            name: "0.js",
          },
          {
            imports: [{ targetChunkIndex: 2, type: "static" as const }],
            name: "1.js",
          },
          {
            imports: [{ targetChunkIndex: 0, type: "static" as const }],
            name: "2.js",
          },
          {
            imports: [{ targetChunkIndex: 2, type: "static" as const }],
            name: "3.js",
          },
        ],
      };

      const measured = yield* measureStartupSet(files, graph, "0.js");
      expect(measured.startupFiles).toEqual(["0.js", "1.js", "2.js"]);
      expect(measured.startupBytes).toBe(
        sizes.slice(0, 3).reduce((sum, size) => sum + size, 0)
      );
    })
);

it.effect.prop(
  "accepts the exact startup ceiling and rejects a static chunk growing one byte beyond it",
  { chunkBytes: bytes, entryBytes: bytes },
  ({ entryBytes, chunkBytes }) =>
    Effect.gen(function* staticCeiling() {
      const graph = {
        chunks: [
          {
            imports: [{ targetChunkIndex: 1, type: "static" as const }],
            name: "entry.js",
          },
          { name: "chunk.js" },
        ],
      };

      const budget = entryBytes + chunkBytes;

      for (const growth of [0, 1]) {
        const measured = yield* measureStartupSet(
          [
            { bytes: entryBytes, path: "entry.js" },
            { bytes: chunkBytes + growth, path: "chunk.js" },
          ],
          graph,
          "entry.js"
        );

        const result = assertStartupBudget(
          measured.startupBytes,
          budget,
          "Mischief"
        );

        if (growth === 0) {
          yield* result;
        } else {
          const error = yield* result.pipe(Effect.flip);
          expect(error.bytes).toBe(budget + 1);
          expect(error.budget).toBe(budget);
        }
      }
    })
);

it.effect.prop(
  "dynamic-only growth beyond the total JS alarm leaves the startup gate unchanged",
  { entryBytes: bytes, growth: bytes },
  ({ entryBytes, growth }) =>
    Effect.gen(function* dynamicGrowth() {
      const graph = {
        chunks: [
          {
            imports: [{ targetChunkIndex: 1, type: "dynamic" as const }],
            name: "entry.js",
          },
          {
            imports: [{ targetChunkIndex: 2, type: "static" as const }],
            name: "dynamic.js",
          },
          { name: "dynamic-child.js" },
        ],
      };

      const measured = yield* measureStartupSet(
        [
          { bytes: entryBytes, path: "entry.js" },
          { bytes: 2_500_000 + growth, path: "dynamic.js" },
          { bytes: growth, path: "dynamic-child.js" },
        ],
        graph,
        "entry.js"
      );

      expect(measured.startupBytes).toBe(entryBytes);
      expect(measured.startupFiles).toEqual(["entry.js"]);
      yield* assertStartupBudget(measured.startupBytes, entryBytes, "Mischief");
    })
);

it.effect.prop(
  "refuses missing entry, static graph targets and uploaded static chunks",
  {
    missingIndex: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 2, minimum: 0 }))
    ),
  },
  ({ missingIndex }) =>
    Effect.gen(function* missingEvidence() {
      const graph = {
        chunks: [
          {
            imports: [
              {
                targetChunkIndex: missingIndex === 1 ? 2 : 1,
                type: "static" as const,
              },
            ],
            name: "entry.js",
          },
          { name: "chunk.js" },
        ],
      };

      const error = yield* measureStartupSet(
        [{ bytes: 1, path: "entry.js" }],
        graph,
        missingIndex === 0 ? "absent.js" : "entry.js"
      ).pipe(Effect.flip);

      expect(error._tag).toBe("StartupGraphInvalid");
      expect(error.detail).toContain("absent from the graph or upload");
    })
);
