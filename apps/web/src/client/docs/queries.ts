import { toRpcGroup } from "@rat-stack/capability/rpc-group";
import { readContract, searchContract } from "@rat-stack/core/contracts";
import { Cache, Context, Duration, Effect, Exit, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

const { group } = toRpcGroup([searchContract, readContract]);

const protocol = RpcClient.layerProtocolHttp({ url: "/rpc" }).pipe(
  Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson])
);

const make = Effect.gen(function* makeDocumentQueries() {
  const client = yield* RpcClient.make(group).pipe(Effect.provide(protocol));

  const search = yield* Cache.make({
    capacity: Number.POSITIVE_INFINITY,
    lookup: (query: string) => client.search({ limit: 10, query }),
    timeToLive: "30 seconds",
  });

  const read = yield* Cache.makeWith((id: string) => client.read({ id }), {
    capacity: Number.POSITIVE_INFINITY,
    timeToLive: (exit) =>
      Exit.isSuccess(exit) ? Duration.infinity : Duration.zero,
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
