import { expect, it } from "@effect/vitest";
import { toToolkit } from "@rat-stack/capability/toolkit";
import type { WebMcpTool } from "@rat-stack/capability/web-mcp";
import {
  capabilities,
  contentCapabilities,
} from "@rat-stack/site/capabilities";
import { nodeContentLayer } from "@rat-stack/site/node-content";
import { Effect, Layer } from "effect";
import { McpServer } from "effect/ai";

import {
  makeMcpClient,
  serverLayer,
} from "../../../packages/capability/test/mcp-harness.js";
import { registerReaderTools } from "../src/client/web-mcp.js";

const projection = toToolkit(contentCapabilities);

const mcp = McpServer.toolkit(projection.toolkit).pipe(
  Layer.provide(projection.layer),
  Layer.provide(nodeContentLayer),
  Layer.provide(serverLayer)
);

it.effect(
  "registers exactly the public content tools with the schemas advertised by MCP",
  () =>
    Effect.gen(function* compareReaderToolCatalog() {
      const registered = new Map<string, WebMcpTool>();
      const signal = yield* Effect.abortSignal;
      yield* registerReaderTools(
        {
          registerTool(tool) {
            registered.set(tool.name, tool);
          },
        },
        signal
      );

      const client = yield* makeMcpClient(mcp);
      const { tools } = yield* client["tools/list"]({});

      const allowedNames = capabilities
        .filter(
          ({ contract }) =>
            contract.annotations.readOnly &&
            !contract.needsApproval &&
            contract.name !== "execute"
        )
        .map(({ contract }) => contract.name)
        .toSorted();

      expect([...registered.keys()].toSorted()).toEqual(allowedNames);
      expect(tools.map((tool) => tool.name).toSorted()).toEqual(allowedNames);

      for (const tool of tools) {
        expect(registered.get(tool.name)?.inputSchema, tool.name).toEqual(
          tool.inputSchema
        );
        expect(
          registered.get(tool.name)?.annotations.consequentialHint,
          tool.name
        ).toBe(false);
      }
    })
);
