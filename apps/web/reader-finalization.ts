import { NodeServices } from "@effect/platform-node";
import { Effect, Path } from "effect";
import type { Plugin } from "vite";

import { finalizeReader } from "./scripts/reader-build.js";

export const readerFinalizationPlugin = (): Plugin => ({
  apply: "build",
  buildApp: {
    // @effect-diagnostics-next-line asyncFunction:off -- Vite awaits finalization after the Foldkit prerender hook.
    handler: async (builder) => {
      const { client } = builder.environments;

      if (client === undefined) {
        throw new Error(
          "Reader finalization requires a completed client build"
        );
      }

      await Effect.runPromise(
        Effect.gen(function* finalizeBuild() {
          const path = yield* Path.Path;

          yield* finalizeReader(
            builder.config.root,
            path.resolve(client.config.root, client.config.build.outDir)
          );
        }).pipe(Effect.provide(NodeServices.layer))
      );
    },
    order: "post",
  },
  name: "reader-finalization",
  sharedDuringBuild: true,
});
