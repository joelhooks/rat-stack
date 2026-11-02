import { toToolkit } from "@rat-stack/capability/toolkit";
import { Layer } from "effect";
import * as McpProtocol from "effect/ai/McpProtocol";
import * as McpServer from "effect/ai/McpServer";

import {
  authenticatedCapabilities,
  capabilities,
} from "./capabilities/index.js";
import { privateMcpTracingLayer } from "./http-privacy.js";
import { mcpContent } from "./mcp-content.js";

export const toolkitProjection = toToolkit(capabilities);

const authenticatedToolkitProjection = toToolkit(authenticatedCapabilities);

export const modernMcpProtocols = [McpProtocol.v2026_07_28] as const;

export const legacyMcpProtocols = [
  McpProtocol.v2025_11_25,
  McpProtocol.v2025_06_18,
  McpProtocol.v2025_03_26,
  McpProtocol.v2024_11_05,
] as const;

const mcpTransport = (
  protocols: typeof modernMcpProtocols | typeof legacyMcpProtocols
) =>
  McpServer.layerHttp({
    allowedOrigins: ["https://ratstack.sh", "http://localhost:1337"],
    description:
      "Search, read, and traverse the rat-stack source corpus and lore graph",
    instructions:
      "Use search and read for source text. Use backlinks, neighbors, mentions, and path to traverse lore relationships. Use execute when one short program can replace several tool calls.",
    name: "sh.ratstack/rat-stack",
    path: "/mcp",
    protocols,
    version: "0.2.0",
    websiteUrl: "https://ratstack.sh/",
  }).pipe(Layer.provide(privateMcpTracingLayer));

export const mcpLayer = (
  protocols: typeof modernMcpProtocols | typeof legacyMcpProtocols,
  feedback = false
) =>
  Layer.mergeAll(
    feedback
      ? McpServer.toolkit(authenticatedToolkitProjection.toolkit).pipe(
          Layer.provide(authenticatedToolkitProjection.layer)
        )
      : McpServer.toolkit(toolkitProjection.toolkit).pipe(
          Layer.provide(toolkitProjection.layer)
        ),
    mcpContent
  ).pipe(Layer.provide(mcpTransport(protocols)));

export const modernMcpLayer = (feedback: boolean) =>
  mcpLayer(modernMcpProtocols, feedback);
