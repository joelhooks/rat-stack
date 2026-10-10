import * as Cloudflare from "alchemy/Cloudflare";
import * as AlchemyHttp from "alchemy/Http";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";

import { mischiefRoutes, readerResponseHeaders } from "../../src/app.js";
import { staticAssetGeneration } from "../../src/bundled-content.generated.js";
import { ContentStore } from "../../src/content-store.js";
import { privateObservability } from "../../src/observability.js";
import { withReaderWebsite } from "../../src/reader-website.js";
import { layerWorkerLoader, sandboxLimits } from "../../src/sandbox-loader.js";
import { StaticAssets } from "../../src/static-assets.js";
import { workerAssetsLayer } from "../../src/worker-content.js";

export default class ColdContentWorker extends Cloudflare.Worker<ColdContentWorker>()(
  "ColdContentWorker",
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
  Effect.gen(function* coldContentWorker() {
    const nativeAssets = yield* StaticAssets.pipe(
      Effect.provide(workerAssetsLayer)
    );

    const assets = StaticAssets.of({
      read: (path) => nativeAssets.read(path).pipe(Effect.delay("50 millis")),
    });

    const store = yield* ContentStore.pipe(
      Effect.provide(
        ContentStore.layer.pipe(
          Layer.provide(Layer.succeed(StaticAssets, assets))
        )
      )
    );

    const app = yield* HttpRouter.toHttpEffect(
      mischiefRoutes({ assets, contentStore: store }).pipe(
        Layer.provide(AlchemyHttp.Platform),
        Layer.provide(
          layerWorkerLoader(
            {
              load: () => {
                throw new Error("Unexpected sandbox request");
              },
            },
            sandboxLimits
          )
        )
      )
    ).pipe(Effect.orDie);

    return {
      fetch: withReaderWebsite(
        {
          // oxlint-disable-next-line typescript/promise-function-async -- The Website stub implements a native service binding.
          fetch: () =>
            Promise.resolve(
              new Response("Reader", {
                headers: { "content-type": "text/html" },
              })
            ),
        },
        readerResponseHeaders(store)
      )(app),
    };
  })
) {}
