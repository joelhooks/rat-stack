import RpcBackend from "@rat-stack/mischief/rpc-worker";
import * as Cloudflare from "alchemy/Cloudflare";
import { Stage } from "alchemy/Stage";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { privateObservability } from "../../mischief/src/observability.js";

export class Website extends Cloudflare.Website.Foldkit<Website>()(
  "Website",
  Effect.gen(function* websiteProps() {
    const stage = yield* Stage;
    const preview = /^pr-[1-9][0-9]*$/u.test(stage);

    const props = {
      assets: {
        notFoundHandling: "none",
        runWorkerFirst: ["/rpc", "/rpc/*", "/__rat", "/__rat/*"],
      },
      env: { BACKEND: RpcBackend },
      observability: privateObservability,
      rootDir: "../web",
    } satisfies Cloudflare.Website.FoldkitProps;

    if (!preview) {
      return props;
    }

    const commit = yield* Config.schema(
      Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/u)),
      "PREVIEW_COMMIT"
    ).pipe(Effect.orDie);

    return {
      ...props,
      domain: { name: `${stage}.ratstack.sh`, zoneName: "ratstack.sh" },
      env: { ...props.env, PREVIEW_COMMIT: commit },
      workersDev: false,
    };
  })
) {}

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;
