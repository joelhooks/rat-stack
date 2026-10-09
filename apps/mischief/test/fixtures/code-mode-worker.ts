import {
  ExecuteInput,
  ExecuteResult,
  toExecuteCapability,
} from "@rat-stack/capability/code-mode";
import { defineContract } from "@rat-stack/capability/contract";
import { toHttpApi } from "@rat-stack/capability/http-api";
import { implement } from "@rat-stack/capability/implement";
import { SandboxError } from "@rat-stack/capability/sandbox";
import { AssetReadError } from "@rat-stack/core/contracts";
import * as Cloudflare from "alchemy/Cloudflare";
import * as AlchemyHttp from "alchemy/Http";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { probe } from "../../../../packages/capability/test/fixtures/sandbox-probe.js";
import { staticAssetGeneration } from "../../src/bundled-content.generated.js";
import {
  contentLayer,
  execute,
  search,
  read,
} from "../../src/capabilities/index.js";
import { privateObservability } from "../../src/observability.js";
import {
  layerWorkerLoader,
  sandboxLimits,
} from "../../src/sandbox-worker-loader.js";
import type { WorkerLoaderBinding } from "../../src/sandbox-worker-loader.js";
import { StaticAssets } from "../../src/static-assets.js";
import { workerAssetsLayer } from "../../src/worker-content.js";

const assetProbeContract = defineContract("assetProbe", {
  description: "Prime local assets without loading content caches",
  failure: AssetReadError,
  input: Schema.Struct({}),
  output: Schema.Finite,
});

const assetProbe = implement(assetProbeContract, () =>
  StaticAssets.use((assets) => assets.read("/favicon.svg")).pipe(
    Effect.map((bytes) => bytes.byteLength)
  )
);

const probeExecute = toExecuteCapability([probe]);

const sandboxProbeContract = defineContract("sandboxProbe", {
  description: "Run the shared sandbox conformance programs",
  failure: SandboxError,
  input: ExecuteInput,
  output: ExecuteResult,
});

const sandboxProbe = implement(
  sandboxProbeContract,
  probeExecute.capability.handler
);

const projection = toHttpApi(
  "CodeModeTest",
  [execute, search, read, assetProbe, sandboxProbe],
  {
    prefix: "/api",
  }
);

export default class CodeModeWorker extends Cloudflare.Worker<CodeModeWorker>()(
  "CodeModeWorker",
  {
    assets: {
      directory: new URL(
        `../../dist/content/assets/${staticAssetGeneration}`,
        import.meta.url
      ).pathname,
      htmlHandling: "none",
      runWorkerFirst: true,
    },
    compatibility: { date: "2026-05-28" },
    dev: { port: 0 },
    main: import.meta.url,
    observability: privateObservability,
  },
  Effect.gen(function* makeCodeModeWorker() {
    if (globalThis.__ALCHEMY_RUNTIME__ !== true) {
      yield* Cloudflare.WorkerLoader("CODE_SANDBOX");
    }

    const environment = yield* Cloudflare.WorkerEnvironment;

    // SAFETY: CODE_SANDBOX is the native worker_loader binding declared by this test Worker.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const bindings = environment as {
      readonly CODE_SANDBOX: WorkerLoaderBinding;
    };

    return {
      fetch: yield* HttpRouter.toHttpEffect(
        HttpApiBuilder.layer(projection.api).pipe(
          Layer.provide(projection.layer),
          Layer.provide(
            Layer.merge(
              workerAssetsLayer,
              contentLayer.pipe(Layer.provide(workerAssetsLayer))
            )
          ),
          Layer.provide(AlchemyHttp.Platform),
          Layer.provide(layerWorkerLoader(bindings.CODE_SANDBOX, sandboxLimits))
        )
      ).pipe(Effect.orDie),
    };
  })
) {}
