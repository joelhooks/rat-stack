import { toRpc } from "@rat-stack/capability/rpc";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { contentCapabilities, contentLayer } from "./capabilities/index.js";
import { privateObservability } from "./observability.js";

export const rpcProjection = toRpc(contentCapabilities);

export default class RpcBackend extends Cloudflare.Workers.RpcWorker<RpcBackend>()(
  "RpcBackend",
  {
    main: import.meta.url,
    observability: privateObservability,
    schema: rpcProjection.group,
    workersDev: false,
  },
  Effect.succeed(
    RpcServer.toHttpEffect(rpcProjection.group).pipe(
      Effect.provide(
        Layer.mergeAll(rpcProjection.layer, RpcSerialization.layerJson).pipe(
          Layer.provide(contentLayer)
        )
      )
    )
  )
) {}
