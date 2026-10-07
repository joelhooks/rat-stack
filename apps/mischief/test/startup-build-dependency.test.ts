import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { assertBuildOnlyModules } from "../scripts/startup-build-dependency.ts";
import { entryBudgetBytes, startupBundle } from "../scripts/startup-bundle.ts";

it.effect(
  "rejects build-only snippet or highlighting modules in the composed Worker graph",
  () =>
    Effect.gen(function* graphBoundary() {
      const modules = [
        "../../packages/code-snippets/src/index.ts",
        "../../node_modules/.pnpm/shiki@3.23.0/node_modules/shiki/dist/index.mjs",
        "../../node_modules/@shikijs/core/dist/index.mjs",
      ];

      const error = yield* assertBuildOnlyModules(modules).pipe(Effect.flip);
      expect(error.modules).toEqual(modules);
      yield* assertBuildOnlyModules([
        "../src/worker.ts",
        "../../packages/core/src/contracts.ts",
      ]);
    })
);

const catalogueModules = (paths: readonly string[]) =>
  paths.filter((path) =>
    /\/(?:zod|@json-render\/core)\/|\/page-catalog\.js$/u.test(path)
  );

it.layer(NodeServices.layer)((test) => {
  test.effect(
    "the built Worker keeps catalogue machinery cold and its entry below the unchanged byte budget",
    () =>
      Effect.gen(function* coldCatalogueBundle() {
        const bundle = yield* startupBundle;

        expect(bundle.entryBytes).toBeLessThanOrEqual(entryBudgetBytes);
        expect(catalogueModules(bundle.entryModules)).toEqual([]);
        expect(catalogueModules(bundle.modules).length).toBeGreaterThan(0);
      })
  );
});
