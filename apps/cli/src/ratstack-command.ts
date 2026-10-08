import { toCommand } from "@rat-stack/capability";
import { localLearnCapabilities } from "@rat-stack/learn/local";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";

import { learnMcpServer } from "./learn-surfaces.js";
import { VERSION } from "./version.js";

const mcpCommand = Command.make("mcp", {}, () =>
  Layer.launch(learnMcpServer).pipe(Effect.orDie)
).pipe(
  Command.withDescription(
    "Serve the learn capabilities as an MCP server over stdio"
  )
);

export const ratstackCommand = Command.make("ratstack").pipe(
  Command.withDescription(
    "Learn rat-stack one concept at a time: local learn commands and an MCP server"
  ),
  Command.withSubcommands([
    ...localLearnCapabilities.map((capability) => toCommand(capability)),
    mcpCommand,
  ])
);

export const runRatstack = Command.runWith(ratstackCommand, {
  version: VERSION,
});
