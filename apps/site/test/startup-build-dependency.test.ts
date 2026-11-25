import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { assertBuildOnlyModules } from "../scripts/startup-build-dependency.ts";

it.effect("rejects build-only modules in the composed Worker graph", () =>
  Effect.gen(function* graphBoundary() {
    const modules = [
      "../../packages/code-snippets/src/index.ts",
      "../../node_modules/.pnpm/shiki@3.23.0/node_modules/shiki/dist/index.mjs",
      "../../node_modules/@shikijs/core/dist/index.mjs",
      "../../packages/og/src/render.ts",
      "../../node_modules/.pnpm/satori@0.63.2/node_modules/satori/dist/index.js",
      "../../node_modules/.pnpm/@resvg+resvg-js@2.6.2/node_modules/@resvg/resvg-js/index.js",
    ];

    const error = yield* assertBuildOnlyModules(modules).pipe(Effect.flip);
    expect(error.modules).toEqual(modules);
    yield* assertBuildOnlyModules([
      "../src/worker.ts",
      "../../packages/core/src/contracts.ts",
    ]);
  })
);
