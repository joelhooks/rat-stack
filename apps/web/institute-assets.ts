import { NodeCrypto, NodeServices } from "@effect/platform-node";
import { Effect, Path } from "effect";
import type { Plugin } from "vite";

import { stageInstituteAssets } from "./src/institute/content/artifact.js";

export const instituteAssetsPlugin = (): Plugin => ({
  apply: "build",
  buildApp: {
    handler: (builder) => {
      const { client } = builder.environments;

      if (client === undefined) {
        return Promise.resolve();
      }

      return Effect.runPromise(
        Effect.gen(function* stageForWebsite() {
          const path = yield* Path.Path;
          yield* stageInstituteAssets(
            path.resolve(client.config.root, client.config.build.outDir)
          );
        }).pipe(Effect.provide([NodeServices.layer, NodeCrypto.layerDigest]))
      );
    },
    order: "post",
  },
  name: "institute-assets",
  sharedDuringBuild: true,
});
