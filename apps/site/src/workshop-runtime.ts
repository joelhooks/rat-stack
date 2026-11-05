import { toHttpApi } from "@rat-stack/capability/http-api";
import { toRpc } from "@rat-stack/capability/rpc";
import { toToolkit } from "@rat-stack/capability/toolkit";
import { workshopCapabilities } from "@rat-stack/core/workshop-directory";
import * as AlchemyHttp from "alchemy/Http";
import { Effect, Layer } from "effect";
import * as McpProtocol from "effect/ai/McpProtocol";
import * as McpServer from "effect/ai/McpServer";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpRouter from "effect/http/HttpRouter";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { workshopDirectoryLayer } from "./workshop-directory.js";

const api = toHttpApi("TokenmaxxWorkshop", workshopCapabilities, {
  prefix: "/tokenmaxx/api",
});

const rpc = toRpc(workshopCapabilities);

const toolkit = toToolkit(workshopCapabilities);

export const workshopRoutes = Layer.mergeAll(
  HttpApiBuilder.layer(api.api, {
    openapiPath: "/tokenmaxx/openapi.json",
  }).pipe(Layer.provide(api.layer), Layer.provide(AlchemyHttp.Platform)),
  RpcServer.layerHttp({
    group: rpc.group,
    path: "/tokenmaxx/rpc",
    protocol: "http",
  }).pipe(Layer.provide(rpc.layer), Layer.provide(RpcSerialization.layerJson)),
  McpServer.toolkit(toolkit.toolkit).pipe(
    Layer.provide(toolkit.layer),
    Layer.provide(
      McpServer.layerHttp({
        allowedOrigins: ["https://ratstack.sh"],
        description: "Published Tokenmaxx workshop resources",
        name: "sh.ratstack/workshop",
        path: "/tokenmaxx/mcp",
        protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25],
        version: "1.0.0",
        websiteUrl: "https://ratstack.sh/tokenmaxx",
      })
    )
  )
);

export const workshopRuntime = HttpRouter.toHttpEffect(
  workshopRoutes.pipe(Layer.provide(workshopDirectoryLayer))
).pipe(Effect.map((fetch) => ({ fetch })));
