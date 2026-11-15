import * as Cloudflare from "@alchemy.run/cloudflare";
import * as DomainCloudflare from "@alchemy.run/domain/Cloudflare";
import { Catalog, CatalogHandlers } from "@rat-stack/catalog/Catalog.model";
import { OperatorApi } from "@rat-stack/catalog/OperatorApi.api";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { privateObservability } from "../../site/src/observability.js";
import { D1CatalogStore } from "./Catalog/D1CatalogStore.ts";
import { OperatorTokenLive } from "./OperatorToken.ts";

const CatalogLive = OperatorTokenLive.pipe(
  Layer.provideMerge(Catalog.layer(CatalogHandlers)),
  Layer.provideMerge(D1CatalogStore),
  Layer.provide(DomainCloudflare.layerDurableObjects())
);

export default class CatalogWorker extends Cloudflare.Worker<CatalogWorker>()(
  "CatalogWorker",
  Effect.gen(function* catalogWorkerProps() {
    const token = yield* Config.option(
      Config.Redacted("CATALOG_OPERATOR_TOKEN")
    );

    return {
      env: Option.match(token, {
        onNone: () => ({}),
        onSome: (value) => ({ CATALOG_OPERATOR_TOKEN: value }),
      }),
      main: import.meta.url,
      observability: privateObservability,
    };
  }),
  Effect.gen(function* hostCatalog() {
    const api = yield* OperatorApi;

    return { fetch: api.fetch };
  }).pipe(Effect.provide(CatalogLive))
) {}
