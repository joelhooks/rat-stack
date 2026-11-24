import { toRpcGroup } from "@rat-stack/capability/rpc-group";
import { toWebMcp } from "@rat-stack/capability/web-mcp";
import type { WebMcpContext } from "@rat-stack/capability/web-mcp";
import { Effect } from "effect";
import { RpcClient } from "effect/rpc";

import { readerRpcProtocol } from "./rpc.js";
import { webMcpContracts } from "./web-mcp-contracts.js";

const { group } = toRpcGroup(webMcpContracts);

export const readerWebMcp = toWebMcp(webMcpContracts);

export const registerReaderTools = (
  context: WebMcpContext,
  signal: AbortSignal
) =>
  Effect.gen(function* readerTools() {
    const call = yield* RpcClient.make(group).pipe(
      Effect.provide(readerRpcProtocol)
    );

    yield* readerWebMcp.register(context, call, { signal });
  });
