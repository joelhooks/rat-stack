import { ResourceNotFound } from "@rat-stack/core/contracts";
import { LoreGraph } from "@rat-stack/lore";
import type { LoreGraphService } from "@rat-stack/lore";
import { Context, Effect, Exit, Layer, Schema } from "effect";

import { staticAssetGeneration } from "./bundled-content.generated.js";
import {
  ContentCatalog,
  ContentResourceSchema,
  GraphSnapshot,
  SearchResource,
  contentPagePath,
} from "./content-data.js";
import { searchContent } from "./search-content.js";
import { AssetReadError } from "./static-assets-error.js";
import { StaticAssets } from "./static-assets.js";

interface ContentStoreService {
  readonly catalog: Effect.Effect<typeof ContentCatalog.Type, AssetReadError>;
  readonly graph: Effect.Effect<LoreGraphService, AssetReadError>;
  readonly search: (
    query: string,
    limit?: number
  ) => Effect.Effect<ReturnType<typeof searchContent>, AssetReadError>;
  readonly read: (
    id: string
  ) => Effect.Effect<
    typeof ContentResourceSchema.Type,
    AssetReadError | ResourceNotFound
  >;
}

const readData = <A>(
  assets: StaticAssets["Service"],
  path: string,
  schema: Schema.Codec<A, unknown>,
  generation: string
) =>
  assets.read(path).pipe(
    Effect.flatMap((bytes) =>
      Schema.decodeUnknownEffect(
        Schema.fromJsonString(
          Schema.Struct({
            data: schema,
            generation: Schema.String,
          })
        )
      )(new TextDecoder().decode(bytes))
    ),
    Effect.mapError((cause) =>
      Schema.is(AssetReadError)(cause)
        ? cause
        : new AssetReadError({ cause, path, reason: "decode" })
    ),
    Effect.flatMap((envelope) =>
      envelope.generation === generation
        ? Effect.succeed(envelope.data)
        : Effect.fail(
            new AssetReadError({
              cause: envelope.generation,
              path,
              reason: "generation",
            })
          )
    )
  );

const cacheData = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.cachedWithTTL(effect, (exit) =>
    Exit.isSuccess(exit) ? "Infinity" : 0
  );

const makeStore = Effect.fn("ContentStore.make")(function* makeStore(
  generation: string
) {
  const assets = yield* StaticAssets;

  const catalog = yield* cacheData(
    readData(assets, "/_content/catalog.json", ContentCatalog, generation)
  );

  const index = yield* cacheData(
    readData(
      assets,
      "/_content/search.json",
      Schema.Array(SearchResource),
      generation
    )
  );

  const graph = yield* cacheData(
    readData(assets, "/_content/graph.json", GraphSnapshot, generation).pipe(
      Effect.flatMap((snapshot) =>
        LoreGraph.pipe(Effect.provide(LoreGraph.layer(snapshot)))
      )
    )
  );

  return {
    catalog,
    graph,
    read: (id) =>
      catalog.pipe(
        Effect.flatMap(
          (
            contents
          ): Effect.Effect<
            typeof ContentResourceSchema.Type,
            ResourceNotFound | AssetReadError
          > => {
            const resource = contents.resources.find(
              (page) => page.id === id || page.routePath === id
            );

            return resource === undefined
              ? Effect.fail(
                  new ResourceNotFound({
                    id,
                    message: `No rat-stack resource has id ${id}`,
                  })
                )
              : readData(
                  assets,
                  contentPagePath(resource.id),
                  ContentResourceSchema,
                  generation
                ).pipe(
                  Effect.filterOrFail(
                    (page) =>
                      page.id === resource.id &&
                      page.digest === resource.digest,
                    () =>
                      new AssetReadError({
                        cause: "Page identity differs from catalog",
                        path: contentPagePath(resource.id),
                        reason: "decode",
                      })
                  )
                );
          }
        )
      ),
    search: (query, limit) =>
      index.pipe(
        Effect.map((resources) => searchContent(resources, query, limit))
      ),
  } satisfies ContentStoreService;
});

export class ContentStore extends Context.Service<
  ContentStore,
  ContentStoreService
>()("mischief/ContentStore") {
  static readonly layerForGeneration = (generation: string) =>
    Layer.effect(ContentStore, makeStore(generation));

  static readonly layer = ContentStore.layerForGeneration(
    staticAssetGeneration
  );
}
