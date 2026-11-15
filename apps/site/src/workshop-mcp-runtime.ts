import { toToolkit } from "@rat-stack/capability/toolkit";
import { attendeeHelpCapabilities } from "@rat-stack/core/tokenmaxx-help";
import { workshopCapabilities } from "@rat-stack/core/workshop-directory";
import { Layer } from "effect";
import * as McpProtocol from "effect/ai/McpProtocol";
import * as McpServer from "effect/ai/McpServer";

const toolkit = toToolkit([
  ...workshopCapabilities,
  ...attendeeHelpCapabilities,
]);

export const workshopMcpRoutes = McpServer.toolkit(toolkit.toolkit).pipe(
  Layer.provide(toolkit.layer),
  Layer.provide(
    McpServer.layerHttp({
      allowedOrigins: ["https://ratstack.sh"],
      description:
        "Published Tokenmaxx workshop resources, and setup help from the workshop desk",
      name: "sh.ratstack/workshop",
      path: "/tokenmaxx/mcp",
      protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25],
      version: "1.0.0",
      websiteUrl: "https://ratstack.sh/tokenmaxx",
    })
  )
);
