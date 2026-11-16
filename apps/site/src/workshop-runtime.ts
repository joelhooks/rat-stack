import { toHttpApi } from "@rat-stack/capability/http-api";
import { toRpc } from "@rat-stack/capability/rpc";
import {
  HelpCaller,
  attendeeHelpCapabilities,
  operatorHelpCapabilities,
} from "@rat-stack/core/tokenmaxx-help";
import { webCryptoLayer } from "@rat-stack/core/web-crypto";
import { workshopCapabilities } from "@rat-stack/core/workshop-directory";
import * as AlchemyHttp from "alchemy/Http";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { RpcSerialization, RpcServer } from "effect/rpc";

import {
  inspectMcpRequest,
  legacySessionOf,
  MODERN_MCP_VERSION,
  routeLegacyMcp,
} from "./legacy-mcp/routing.js";
import type { LegacyMcpRouter } from "./legacy-mcp/routing.js";
import { workshopDirectoryLayer } from "./workshop-directory.js";
import type { WorkshopHelpServices } from "./workshop-help/live.js";
import { lazyWorkshopMcpHandler } from "./workshop-mcp-loader.js";

const attendeeCapabilities = [
  ...workshopCapabilities,
  ...attendeeHelpCapabilities,
] as const;

const api = toHttpApi(
  "TokenmaxxWorkshop",
  [...attendeeCapabilities, ...operatorHelpCapabilities],
  {
    prefix: "/tokenmaxx/api",
    provide: [
      {
        failure: Schema.Never,
        from: (request: HttpServerRequest.HttpServerRequest) =>
          Effect.succeed({
            authorization: Option.map(
              Option.fromUndefinedOr(request.headers.authorization),
              (header) => Redacted.make(header)
            ),
          }),
        tag: HelpCaller,
      },
    ],
  }
);

const rpc = toRpc(attendeeCapabilities);

const lazyWorkshopMcpRoutes = HttpRouter.use(
  Effect.fnUntraced(function* registerWorkshopMcp(router) {
    const fetch = yield* lazyWorkshopMcpHandler;
    yield* router.add("*", "/tokenmaxx/mcp", Effect.flatten(fetch));
  })
);

export const workshopRoutes = Layer.mergeAll(
  HttpApiBuilder.layer(api.api, {
    openapiPath: "/tokenmaxx/openapi.json",
  }).pipe(Layer.provide(api.layer), Layer.provide(AlchemyHttp.Platform)),
  RpcServer.layerHttp({
    group: rpc.group,
    path: "/tokenmaxx/rpc",
    protocol: "http",
  }).pipe(Layer.provide(rpc.layer), Layer.provide(RpcSerialization.layerJson)),
  lazyWorkshopMcpRoutes
);

export const workshopRoutesFor = (router: LegacyMcpRouter) =>
  Layer.merge(
    workshopRoutes,
    HttpRouter.middleware(
      (next) =>
        Effect.gen(function* routeWorkshopSession() {
          const request = yield* HttpServerRequest.HttpServerRequest;

          const isMcp =
            new URL(request.url, "https://ratstack.sh").pathname ===
            "/tokenmaxx/mcp";

          const modernMcp =
            request.headers["mcp-protocol-version"] === MODERN_MCP_VERSION;

          const routing = {
            envelope:
              isMcp && !modernMcp && request.method === "POST"
                ? yield* inspectMcpRequest(request)
                : null,
            isMcp,
            modernMcp,
          };

          const session = yield* legacySessionOf(request, routing).pipe(
            Effect.provide(webCryptoLayer)
          );

          return session === null
            ? yield* next
            : yield* routeLegacyMcp(router, request, session, routing);
        }),
      { global: true }
    )
  );

export const workshopRuntimeFor = <E, R>(
  router: LegacyMcpRouter,
  help: Layer.Layer<WorkshopHelpServices, E, R>
) =>
  HttpRouter.toHttpEffect(
    workshopRoutesFor(router).pipe(
      Layer.provide(Layer.merge(workshopDirectoryLayer, help))
    )
  ).pipe(Effect.map((fetch) => ({ fetch })));
