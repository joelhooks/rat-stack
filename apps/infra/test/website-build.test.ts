import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

import { runViteBuildChild } from "../node_modules/alchemy/lib/Cloudflare/Workers/ViteChild.js";

it.layer(NodeServices.layer)((test) => {
  test.effect(
    "Alchemy production builds the SSR Worker and prerendered featured asset",
    () =>
      Effect.gen(function* websiteProductionBuild() {
        const result = yield* runViteBuildChild(
          {
            compatibilityDate: "2026-05-28",
            compatibilityFlags: ["nodejs_compat"],
            env: {},
            main: "src/worker.ts",
            rootDir: new URL("../../web/", import.meta.url).pathname,
            viteEnvironments: undefined,
          },
          (_channel, line) => Effect.log(line)
        );

        const fs = yield* FileSystem.FileSystem;

        expect(
          result.serverBundle?.files.some((file) => file.path.endsWith(".js"))
        ).toBe(true);

        if (result.clientDirectory === undefined) {
          return yield* Effect.die(
            new Error("Alchemy did not emit the Website client assets.")
          );
        }

        const featured = yield* fs.readFileString(
          `${result.clientDirectory}/featured/index.html`
        );

        expect(featured).toContain("<h1");
        expect(featured).toContain("https://stickers.badass.dev");

        return featured;
      }),
    { timeout: 120_000 }
  );
});
