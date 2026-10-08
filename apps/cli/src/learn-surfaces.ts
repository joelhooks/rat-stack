import { toToolkit } from "@rat-stack/capability";
import { localLearnCapabilities } from "@rat-stack/learn/local";
import { Layer, Logger } from "effect";
import { McpServer } from "effect/ai";

import { mcpProtocols } from "./mcp-protocols.js";
import { VERSION } from "./version.js";

export const learnTools = toToolkit(localLearnCapabilities);

export const learnMcpServer = McpServer.toolkit(learnTools.toolkit).pipe(
  Layer.provideMerge(learnTools.layer),
  Layer.provide(
    McpServer.layerStdio({
      name: "ratstack",
      protocols: mcpProtocols,
      version: VERSION,
    })
  ),
  Layer.provide(Layer.succeed(Logger.LogToStderr, true))
);
