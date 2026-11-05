import * as Cloudflare from "@alchemy.run/cloudflare";
import { Effect } from "effect";

import { contentAssetsForBuild } from "./asset-deployment.js";
import { staticAssetGeneration } from "./bundled-content.generated.js";
import { privateObservability } from "./observability.js";
import { workerAssetsLayer } from "./worker-content.js";
import { workshopAssets } from "./workshop-assets.js";
import { workshopRuntime } from "./workshop-runtime.js";

export default class Workshop extends Cloudflare.Worker<Workshop>()(
  "Workshop",
  Effect.gen(function* workshopProps() {
    const assets = yield* contentAssetsForBuild(
      new URL("../dist/content", import.meta.url).pathname,
      staticAssetGeneration,
      workshopAssets
    ).pipe(Effect.orDie);

    return {
      assets,
      compatibility: { date: "2026-05-28" },
      main: import.meta.url,
      observability: privateObservability,
      routes: [
        { pattern: "ratstack.sh/tokenmaxx/mcp*", zoneName: "ratstack.sh" },
        { pattern: "ratstack.sh/tokenmaxx/rpc*", zoneName: "ratstack.sh" },
        { pattern: "ratstack.sh/tokenmaxx/api/*", zoneName: "ratstack.sh" },
        {
          pattern: "ratstack.sh/tokenmaxx/openapi.json",
          zoneName: "ratstack.sh",
        },
      ],
      workersDev: false,
    };
  }),
  workshopRuntime.pipe(Effect.provide(workerAssetsLayer), Effect.orDie)
) {}
