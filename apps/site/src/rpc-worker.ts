import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";

import { liveFlagsLayer } from "./flags.js";
import { traceObservability, traceSettings } from "./observability.js";
import { rpcRuntime, rpcWorkerProps } from "./rpc-backend-runtime.js";

export { rpcProjection, rpcContentDirectory } from "./rpc-backend-runtime.js";

export default class RpcBackend extends Cloudflare.Workers.RpcWorker<RpcBackend>()(
  "RpcBackend",
  {
    ...rpcWorkerProps(import.meta.url),
    observability: traceSettings.pipe(
      Effect.map(traceObservability),
      Effect.orDie
    ),
  },
  rpcRuntime(liveFlagsLayer)
) {}
