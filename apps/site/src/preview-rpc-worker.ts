import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { flagsLayer } from "./flags.js";
import { traceObservability, traceSettings } from "./observability.js";
import { rpcRuntime, rpcWorkerProps } from "./rpc-backend-runtime.js";

export default class PreviewRpcBackend extends Cloudflare.Workers.RpcWorker<PreviewRpcBackend>()(
  "RpcBackend",
  {
    ...rpcWorkerProps(import.meta.url),
    observability: traceSettings.pipe(
      Effect.map(traceObservability),
      Effect.orDie
    ),
  },
  // oxlint-disable-next-line anti-slop-effect/no-ordie-in-service-construction -- Preview Worker initialization rejects invalid flag configuration; the RPC request runtime has no configuration recovery channel.
  rpcRuntime(flagsLayer.pipe(Layer.orDie))
) {}
