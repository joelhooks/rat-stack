import { toHttpApi } from "@rat-stack/capability/http-api";
import * as Cloudflare from "alchemy/Cloudflare";
import * as AlchemyHttp from "alchemy/Http";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { contentLayer, execute } from "../../src/capabilities/index.js";
import {
  layerWorkerLoader,
  sandboxLimits,
} from "../../src/sandbox-worker-loader.js";
import type { WorkerLoaderBinding } from "../../src/sandbox-worker-loader.js";

const projection = toHttpApi("CodeModeTest", [execute], { prefix: "/api" });

export default class CodeModeWorker extends Cloudflare.Worker<CodeModeWorker>()(
  "CodeModeWorker",
  {
    compatibility: { date: "2026-05-28" },
    dev: { port: 0 },
    main: import.meta.url,
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
          Layer.provide(contentLayer),
          Layer.provide(AlchemyHttp.Platform),
          Layer.provide(layerWorkerLoader(bindings.CODE_SANDBOX, sandboxLimits))
        )
      ).pipe(Effect.orDie),
    };
  })
) {}
