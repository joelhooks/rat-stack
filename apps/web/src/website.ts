import RpcBackend from "@rat-stack/mischief/rpc-worker";
import * as Cloudflare from "alchemy/Cloudflare";
import { Stage } from "alchemy/Stage";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  traceObservability,
  traceSettings,
} from "../../mischief/src/observability.js";

export class Website extends Cloudflare.Website.Foldkit<Website>()(
  "Website",
  Effect.gen(function* websiteProps() {
    const traces = yield* traceSettings.pipe(Effect.orDie);
    const stage = yield* Stage;
    const preview = /^pr-[1-9][0-9]*$/u.test(stage);

    const props = {
      assets: {
        htmlHandling: "drop-trailing-slash",
        notFoundHandling: "none",
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
      env: { BACKEND: RpcBackend },
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
