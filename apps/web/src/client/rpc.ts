import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";

export const readerRpcProtocol = RpcClient.layerProtocolHttp({
  url: "/rpc",
}).pipe(Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson]));
