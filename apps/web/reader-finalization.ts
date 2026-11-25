import { NodeServices } from "@effect/platform-node";
import { Effect, Path } from "effect";
import type { Plugin } from "vite";

import { finalizePrerender } from "./scripts/reader-build.js";

export const readerFinalizationPlugin = (): Plugin => ({
  apply: "build",
  buildApp: {
    // @effect-diagnostics-next-line asyncFunction:off -- Vite awaits finalization after the Foldkit prerender hook.
    handler: async (builder) => {
      const { client, ssr } = builder.environments;

      if (client === undefined || ssr === undefined) {
        throw new Error(
          "Reader finalization requires completed client and SSR builds"
        );
      }

      await Effect.runPromise(
        Effect.gen(function* finalizeBuild() {
          const path = yield* Path.Path;

          yield* finalizePrerender(
            builder.config.root,
            path.resolve(client.config.root, client.config.build.outDir),
            path.resolve(ssr.config.root, ssr.config.build.outDir)
          );
        }).pipe(Effect.provide(NodeServices.layer))
      );
    },
    order: "post",
  },
  name: "reader-finalization",
  sharedDuringBuild: true,
});
