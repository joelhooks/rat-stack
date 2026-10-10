import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { HttpRouter } from "effect/http";

import { emitAssets } from "../scripts/emit-assets.ts";
import { mischiefRoutes } from "../src/app.js";
import { contentAssetsForBuild } from "../src/asset-deployment.js";
import {
  read,
  search,
  backlinks,
  neighbors,
  mentions,
  path,
} from "../src/capabilities/index.js";
import {
  ContentCatalog,
  ContentResourceSchema,
  GraphSnapshot,
  SearchResource,
  contentPagePath,
} from "../src/content-data.js";
import { ContentStore } from "../src/content-store.js";
import { nodeAssetsForGeneration } from "../src/node-content.js";
import { StaticAssets } from "../src/static-assets.js";
import rawFixture from "./fixtures/content-store.json" with { type: "json" };
import { TestSandbox } from "./test-sandbox.js";

const Fixture = Schema.Struct({
  backlinksCases: Schema.Array(
    Schema.Struct({
      input: backlinks.contract.input,
      output: backlinks.contract.output,
    })
  ),
  catalog: ContentCatalog,
  graph: GraphSnapshot,
  index: Schema.Array(SearchResource),
  mentionsCases: Schema.Array(
    Schema.Struct({
      input: mentions.contract.input,
      output: mentions.contract.output,
    })
  ),
  neighborsCases: Schema.Array(
    Schema.Struct({
      input: neighbors.contract.input,
      output: neighbors.contract.output,
    })
  ),
  pages: Schema.Array(ContentResourceSchema),
  pathCases: Schema.Array(
    Schema.Struct({ input: path.contract.input, output: path.contract.output })
  ),
  readCases: Schema.Array(
    Schema.Struct({ input: read.contract.input, output: read.contract.output })
  ),
  searchCases: Schema.Array(
    Schema.Struct({
      input: search.contract.input,
      output: search.contract.output,
    })
  ),
});

const countedAssets = (
  assets: StaticAssets["Service"],
  calls: Ref.Ref<readonly string[]>
) =>
  StaticAssets.of({
    read: (target) =>
      Ref.update(calls, (paths) => [...paths, target]).pipe(
        Effect.andThen(assets.read(target))
      ),
  });

const makeFixture = Effect.fn("makeContentFixture")(function* makeFixture() {
  const fs = yield* FileSystem.FileSystem;
  const fixture = yield* Schema.decodeUnknownEffect(Fixture)(rawFixture);
  const directory = yield* fs.makeTempDirectoryScoped();

  const data = yield* Schema.decodeUnknownEffect(
    Schema.Array(Schema.Struct({ path: Schema.String, value: Schema.Json }))
  )([
    { path: "/_content/catalog.json", value: fixture.catalog },
    { path: "/_content/search.json", value: fixture.index },
    { path: "/_content/graph.json", value: fixture.graph },
    ...fixture.pages.map((page) => ({
      path: contentPagePath(page.id),
      value: page,
    })),
  ]);

  const manifest = yield* emitAssets({
    data,
    directory,
    images: [],
    pages: [],
  });

  const assets = yield* StaticAssets.pipe(
    Effect.provide(nodeAssetsForGeneration(directory, manifest.generation))
  );

  const calls = yield* Ref.make<readonly string[]>([]);
  const recorded = countedAssets(assets, calls);

  const store = yield* ContentStore.pipe(
    Effect.provide(
      ContentStore.layerForGeneration(manifest.generation).pipe(
        Layer.provide(Layer.succeed(StaticAssets, recorded))
      )
    )
  );

  return {
    assets: recorded,
    calls,
    directory,
    fixture,
    generation: manifest.generation,
    store,
  };
});

const verifyFixture = Effect.fn("verifyContentFixture")(function* verifyFixture(
  fixture: typeof Fixture.Type
) {
  for (const row of fixture.searchCases) {
    expect(JSON.stringify(yield* search.handler(row.input))).toBe(
      JSON.stringify(row.output)
    );
  }

  for (const row of fixture.readCases) {
    const output = yield* read.handler(row.input);
    const decoded = yield* Schema.decodeEffect(read.contract.output)(output);

    expect(JSON.stringify(decoded)).toBe(JSON.stringify(row.output));
  }

  for (const row of fixture.backlinksCases) {
    expect(JSON.stringify(yield* backlinks.handler(row.input))).toBe(
      JSON.stringify(row.output)
    );
  }

  for (const row of fixture.neighborsCases) {
    expect(JSON.stringify(yield* neighbors.handler(row.input))).toBe(
      JSON.stringify(row.output)
    );
  }

  for (const row of fixture.mentionsCases) {
    expect(JSON.stringify(yield* mentions.handler(row.input))).toBe(
      JSON.stringify(row.output)
    );
  }

  for (const row of fixture.pathCases) {
    expect(JSON.stringify(yield* path.handler(row.input))).toBe(
      JSON.stringify(row.output)
    );
  }
});

it.effect(
  "matches frozen bundled capability outputs through emitted Node assets",
  () =>
    Effect.gen(function* fixtureParity() {
      const { fixture, store } = yield* makeFixture();
      yield* verifyFixture(fixture).pipe(
        Effect.provideService(ContentStore, store)
      );
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "loads nothing at construction, isolates cold reads, and reuses completed data on warm reads",
  () =>
    Effect.gen(function* fetchCounts() {
      const { calls, fixture, store } = yield* makeFixture();
      expect(yield* Ref.get(calls)).toEqual([]);

      const catalogs = yield* Effect.all([store.catalog, store.catalog], {
        concurrency: "unbounded",
      });

      expect(catalogs).toEqual([fixture.catalog, fixture.catalog]);
      expect(yield* Ref.get(calls)).toEqual([
        "/_content/catalog.json",
        "/_content/catalog.json",
      ]);

      for (const page of fixture.pages) {
        yield* store.read(page.id);
        yield* store.read(page.routePath);
      }

      yield* store.search("");
      yield* store.search("capability");
      const graph = yield* store.graph;
      yield* graph.backlinks("a");
      yield* store.graph;

      const paths = yield* Ref.get(calls);
      expect(
        paths.filter((target) => target === "/_content/catalog.json")
      ).toHaveLength(2);
      expect(
        paths.filter((target) => target === "/_content/search.json")
      ).toHaveLength(1);
      expect(
        paths.filter((target) => target === "/_content/graph.json")
      ).toHaveLength(1);
      expect(
        paths.filter((target) => target.startsWith("/_content/pages/"))
      ).toHaveLength(fixture.pages.length * 2);

      const unknown = yield* store.read("unknown").pipe(Effect.flip);
      expect(unknown._tag).toBe("ResourceNotFound");
      expect(yield* Ref.get(calls)).toEqual(paths);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect.prop(
  "refuses any other generation in content reads and both worker plans",
  {
    fragment: Arbitrary.schema(Schema.String),
  },
  ({ fragment }) =>
    Effect.gen(function* generationFence() {
      const fs = yield* FileSystem.FileSystem;
      const paths = yield* Path.Path;
      const { directory, fixture, generation, store } = yield* makeFixture();
      const selected = yield* contentAssetsForBuild(directory, generation);
      expect(selected?.directory).toBe(
        paths.join(directory, "assets", generation)
      );

      const other = `${generation}:${fragment}`;

      const rejectedPlan = yield* contentAssetsForBuild(directory, other).pipe(
        Effect.flip
      );

      expect(rejectedPlan.reason).toBe("generation");

      const graphPath = paths.join(
        directory,
        "assets",
        generation,
        "_content/graph.json"
      );

      yield* fs.writeFileString(
        graphPath,
        JSON.stringify({ data: fixture.graph, generation: other })
      );
      const rejectedRead = yield* store.graph.pipe(Effect.flip);
      expect(rejectedRead.reason).toBe("generation");

      yield* fs.writeFileString(
        graphPath,
        JSON.stringify({ data: fixture.graph, generation })
      );
      expect(yield* store.graph).toBeDefined();
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "keeps unknown ids distinct from missing or corrupt known pages and returns no-store 503",
  () =>
    Effect.gen(function* knownAssetFailure() {
      const fs = yield* FileSystem.FileSystem;
      const paths = yield* Path.Path;
      const { assets, directory, generation, store } = yield* makeFixture();
      const id = "ratstack://repo/Law.svx";

      const target = paths.join(
        directory,
        "assets",
        generation,
        contentPagePath(id).slice(1)
      );

      const original = yield* fs.readFileString(target);

      yield* fs.writeFileString(target, "{}");
      const corrupt = yield* store.read(id).pipe(Effect.flip);
      expect(corrupt._tag).toBe("AssetReadError");

      yield* fs.writeFileString(target, original.replace('"Law"', '"Wrong"'));
      const wrongIdentity = yield* store.read(id).pipe(Effect.flip);
      expect(wrongIdentity._tag).toBe("AssetReadError");

      yield* fs.remove(target);
      const missing = yield* store.read(id).pipe(Effect.flip);
      expect(missing._tag).toBe("AssetReadError");

      const { dispose, handler } = HttpRouter.toWebHandler(
        mischiefRoutes({ assets, contentStore: store }).pipe(
          Layer.provide(TestSandbox)
        ),
        { disableLogger: true }
      );

      yield* Effect.addFinalizer(() => Effect.promise(dispose));
      const respond: (request: Request) => Promise<Response> = handler;

      const response = yield* Effect.promise(
        respond.bind(
          undefined,
          new Request("https://ratstack.sh/api/read", {
            body: JSON.stringify({ id }),
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        )
      );

      const body = yield* Effect.promise(response.text.bind(response));

      expect({ body, status: response.status }).toMatchObject({ status: 503 });
      expect(body).toContain("AssetReadError");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }).pipe(Effect.provide(NodeServices.layer))
);
