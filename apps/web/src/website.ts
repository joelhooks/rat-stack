import { fileURLToPath } from "node:url";

import * as Cloudflare from "@alchemy.run/cloudflare";
import PreviewRpcBackend from "@rat-stack/site/preview-rpc-worker";
import RpcBackend from "@rat-stack/site/rpc-worker";
import { Stage } from "alchemy/Stage";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import {
  traceObservability,
  traceSettings,
} from "../../site/src/observability.js";
import { WebsiteContentManifestError } from "./website-content-manifest-error.js";

const contentManifestPath = fileURLToPath(
  new URL("../../site/dist/content/manifest.json", import.meta.url)
);

const contentGeneration = Effect.gen(function* contentGeneration() {
  const fs = yield* FileSystem.FileSystem;

  const manifest = yield* fs.readFileString(contentManifestPath).pipe(
    Effect.flatMap(
      Schema.decodeEffect(
        Schema.fromJsonString(
          Schema.Struct({ generation: Schema.NonEmptyString })
        )
      )
    ),
    Effect.mapError(
      (cause) =>
        new WebsiteContentManifestError({ cause, path: contentManifestPath })
    ),
    Effect.orDie
  );

  return manifest.generation;
});

export class Website extends Cloudflare.Website.Foldkit<Website>()(
  "Website",
  Effect.gen(function* websiteProps() {
    const traces = yield* traceSettings.pipe(Effect.orDie);
    const stage = yield* Stage;
    const generation = yield* contentGeneration;
    const preview = /^pr-[1-9][0-9]*$/u.test(stage);

    const props = {
      assets: {
        htmlHandling: "drop-trailing-slash",
        runWorkerFirst: [
          "/rpc",
          "/rpc/*",
          "/__error",
          "/__rat",
          "/__rat/*",
          "/prompts",
          "/prompts/*",
        ],
      },
      env: {
        BACKEND: preview ? PreviewRpcBackend : RpcBackend,
        CONTENT_GENERATION: generation,
      },
      observability: traceObservability(traces),
      rootDir: "../web",
      workersDev: false,
    } satisfies Cloudflare.Website.FoldkitProps;

    const tracedProps = traces.enabled
      ? {
          ...props,
          compatibility: { date: "2026-07-28" },
          env: { ...props.env, TRACES_ENABLED: "true" },
        }
      : props;

    if (!preview) {
      return tracedProps;
    }

    const commit = yield* Config.schema(
      Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/u)),
      "PREVIEW_COMMIT"
    ).pipe(Effect.orDie);

    return {
      ...tracedProps,
      domain: { name: `${stage}.ratstack.sh`, zoneName: "ratstack.sh" },
      env: { ...tracedProps.env, PREVIEW_COMMIT: commit },
      workersDev: false,
    };
  })
) {}
