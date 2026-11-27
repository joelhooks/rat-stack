import * as Cloudflare from "@alchemy.run/cloudflare";
import { Config, Effect, Option, Path, Schema } from "effect";

import { silentObservability } from "../../site/src/observability.js";

export const instituteWorker = Effect.gen(function* declareInstitute() {
  const path = yield* Path.Path;

  const artifact = yield* Config.option(
    Config.schema(
      Schema.String.check(
        Schema.makeFilter((directory) => path.isAbsolute(directory))
      ),
      "INSTITUTE_ARTIFACT"
    )
  );

  if (Option.isSome(artifact)) {
    return yield* Cloudflare.Worker("Institute", {
      assets: {
        directory: path.join(artifact.value, "client"),
        notFoundHandling: "none",
        runWorkerFirst: ["/institute/content/*"],
      },
      bundle: false,
      compatibility: { date: "2026-05-25", flags: ["nodejs_compat"] },
      main: path.join(artifact.value, "server/index.js"),
      observability: silentObservability,
      rules: [{ globs: ["**/*.js", "**/*.mjs"] }],
      workersDev: { enabled: false, previewsEnabled: false },
    });
  }

  return null;
});
