import { toRpc } from "@rat-stack/capability/rpc";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { staticAssetGeneration } from "./bundled-content.generated.js";
import { contentCapabilities, contentLayer } from "./capabilities/index.js";
import { privateObservability } from "./observability.js";
import { workerAssetsLayer } from "./worker-content.js";

export const rpcProjection = toRpc(contentCapabilities);

export const rpcContentDirectory = () =>
  new URL(`../dist/content/assets/${staticAssetGeneration}/`, import.meta.url)
    .pathname;

export default class RpcBackend extends Cloudflare.Workers.RpcWorker<RpcBackend>()(
  "RpcBackend",
  {
    assets: {
      get directory() {
        return rpcContentDirectory();
      },
      htmlHandling: "none",
      runWorkerFirst: true,
    },
    main: import.meta.url,
    observability: privateObservability,
    schema: rpcProjection.group,
    workersDev: false,
  },
  Effect.succeed(
    RpcServer.toHttpEffect(rpcProjection.group).pipe(
      Effect.provide(
        Layer.mergeAll(rpcProjection.layer, RpcSerialization.layerJson).pipe(
          Layer.provide(contentLayer.pipe(Layer.provide(workerAssetsLayer)))
        )
      )
    )
  )
) {}
