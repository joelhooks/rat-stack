import { toRpcGroup } from "@rat-stack/capability/rpc-group";
import { readContract, searchContract } from "@rat-stack/core/contracts";
import { Cache, Context, Effect, Layer } from "effect";
import { RpcClient } from "effect/rpc";

import { readerRpcProtocol } from "../rpc.js";

const { group } = toRpcGroup([searchContract, readContract]);

const make = Effect.gen(function* makeDocumentQueries() {
  const client = yield* RpcClient.make(group).pipe(
    Effect.provide(readerRpcProtocol)
  );

  const search = yield* Cache.make({
    capacity: Number.POSITIVE_INFINITY,
    lookup: (query: string) => client.search({ limit: 10, query }),
    timeToLive: "30 seconds",
  });

  const read = yield* Cache.make({
    capacity: Number.POSITIVE_INFINITY,
    lookup: (id: string) => client.read({ id }),
  });

  return {
    read: (id: string) => Cache.get(read, id),
    search: (query: string) => Cache.get(search, query),
  };
});

export class DocumentQueries extends Context.Service<
  DocumentQueries,
  Effect.Success<typeof make>
>()("@rat-stack/web/DocumentQueries", { make }) {
  static readonly layer = Layer.effect(this, this.make);
}
