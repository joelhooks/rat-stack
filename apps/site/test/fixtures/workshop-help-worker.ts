import * as Cloudflare from "@alchemy.run/cloudflare";
import { Effect } from "effect";

import { contentAssetsForBuild } from "../../src/asset-deployment.js";
import { staticAssetGeneration } from "../../src/bundled-content.generated.js";
import { workshopAssets } from "../../src/workshop-assets.js";
import { workshopWorkerInit } from "../../src/workshop-worker-body.js";

export default class WorkshopHelpWorker extends Cloudflare.Worker<WorkshopHelpWorker>()(
  "WorkshopHelpWorker",
  Effect.gen(function* workshopHelpWorkerProps() {
    const assets = yield* contentAssetsForBuild(
      new URL("../../dist/content", import.meta.url).pathname,
      staticAssetGeneration,
      workshopAssets
    ).pipe(Effect.orDie);

    return {
      assets,
      compatibility: { date: "2026-05-28" },
      dev: { port: 0 },
      main: import.meta.url,
    };
  }),
  workshopWorkerInit
) {}
