import { toRpc } from "@rat-stack/capability/rpc";
import { Flags } from "@rat-stack/core/flags";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RpcSerialization, RpcServer } from "effect/rpc";

import { staticAssetGeneration } from "./bundled-content.generated.js";
import {
  contentLayerWithFlags,
  readerCapabilities,
} from "./capabilities/index.js";
import { privateTelemetry, traceSettings } from "./observability.js";
import { workerAssetsLayer } from "./worker-content.js";

export const rpcProjection = toRpc(readerCapabilities);

export const rpcContentDirectory = () =>
  new URL(`../dist/content/assets/${staticAssetGeneration}/`, import.meta.url)
    .pathname;

export const rpcWorkerProps = (main: string) => ({
  assets: {
    get directory() {
      return rpcContentDirectory();
    },
    htmlHandling: "none" as const,
    runWorkerFirst: true,
  },
  compatibility: traceSettings.pipe(
    Effect.map((settings) =>
      settings.enabled ? { date: "2026-07-28" } : undefined
    ),
    Effect.orDie
  ),
  main,
  schema: rpcProjection.group,
  workersDev: false,
});

export const rpcRuntime = <R>(selectedFlags: Layer.Layer<Flags, never, R>) =>
  Effect.gen(function* makeFlagAwareRpc() {
    const flags = yield* Flags.pipe(Effect.provide(selectedFlags));

    // @effect-diagnostics-next-line returnEffectInGen:off -- Alchemy's RPC Worker initialization returns its request Effect.
    return RpcServer.toHttpEffect(rpcProjection.group).pipe(
      Effect.provide(
        Layer.mergeAll(rpcProjection.layer, RpcSerialization.layerJson).pipe(
          Layer.provide(
            contentLayerWithFlags(Layer.succeed(Flags, flags)).pipe(
              Layer.provide(workerAssetsLayer)
            )
          )
        )
      )
    );
  }).pipe(Effect.provide(privateTelemetry));
