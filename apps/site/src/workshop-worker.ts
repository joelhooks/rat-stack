import * as Cloudflare from "@alchemy.run/cloudflare";
import { Effect } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { contentAssetsForBuild } from "./asset-deployment.js";
import { staticAssetGeneration } from "./bundled-content.generated.js";
import { LEGACY_SESSION_HEADER } from "./legacy-mcp/session.js";
import WorkshopLegacyMcp from "./legacy-mcp/workshop-durable-object.js";
import { privateObservability } from "./observability.js";
import { workerAssetsLayer } from "./worker-content.js";
import { workshopAssets } from "./workshop-assets.js";
import { workshopRuntimeFor } from "./workshop-runtime.js";

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
  Effect.gen(function* makeWorkshopWorker() {
    const sessions = yield* WorkshopLegacyMcp;

    return yield* workshopRuntimeFor({
      forward: (session, request) => {
        const headers = new Headers(request.headers);
        headers.set(LEGACY_SESSION_HEADER, session);

        return sessions
          .getByName(session)
          .fetch(HttpServerRequest.fromWeb(new Request(request, { headers })))
          .pipe(Effect.map(HttpServerResponse.toWeb), Effect.orDie);
      },
    });
  }).pipe(Effect.provide(workerAssetsLayer), Effect.orDie)
) {}
