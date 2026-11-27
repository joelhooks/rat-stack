import { expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { createBuilder, createServer } from "vite";
import type { Plugin } from "vite";

import { effectUiPlugin, manifestAssets } from "../effect-ui.js";

it("uses the static manifest graph and keeps first-seen stylesheet order", () => {
  const manifest = {
    "src/entry.ts": {
      css: ["assets/entry.css", "assets/base.css"],
      dynamicImports: ["_later.js"],
      file: "assets/entry.js",
      imports: ["_shared.js", "_other.js"],
      isEntry: true,
    },
    "_shared.js": {
      css: ["assets/base.css", "assets/shared.css"],
      file: "assets/shared.js",
      imports: ["_leaf.js"],
    },
    "_leaf.js": { css: ["assets/leaf.css"], file: "assets/leaf.js" },
    "_other.js": { file: "assets/other.js", imports: ["_leaf.js"] },
    "_later.js": { css: ["assets/later.css"], file: "assets/later.js" },
  };

  expect(manifestAssets(manifest, "src/entry.ts", "/reader/")).toEqual({
    entryScript: "/reader/assets/entry.js",
    modulePreloads: [
      "/reader/assets/shared.js",
      "/reader/assets/leaf.js",
      "/reader/assets/other.js",
    ],
    stylesheets: [
      "/reader/assets/entry.css",
      "/reader/assets/base.css",
      "/reader/assets/shared.css",
      "/reader/assets/leaf.css",
    ],
  });
});

const assetModule = "virtual:reader-effect-ui-assets";

const allStarsEntry = "src/client/all-stars-effect-ui/entry.ts";

const directoryEntry = "src/client/directory-effect-ui/entry.ts";

const newsEntry = "src/client/news-effect-ui/entry.ts";

const readerEntry = "src/client/reader-effect-ui/entry.ts";

const serverEntry = "virtual:reader-asset-fixture";

type ManifestFixture = Parameters<typeof manifestAssets>[0];

const fixture = (overrideManifest?: ManifestFixture): Plugin => ({
  name: "reader-asset-fixture",
  resolveId(id) {
    return id === serverEntry ? `\0${id}` : undefined;
  },
  load(id) {
    if (id === `\0${serverEntry}`) {
      return `export { default } from ${JSON.stringify(assetModule)}`;
    }

    if (
      [allStarsEntry, directoryEntry, newsEntry, readerEntry].some((entry) =>
        id.endsWith(entry)
      )
    ) {
      return `export default ${JSON.stringify(id)}`;
    }

    return null;
  },
  generateBundle: {
    order: "post",
    handler(_options, bundle) {
      const manifest = bundle[".vite/manifest.json"];

      if (manifest?.type === "asset" && overrideManifest !== undefined) {
        manifest.source = JSON.stringify(overrideManifest);
      }
    },
  },
});

const fixtureBuilder = (overrideManifest?: ManifestFixture) =>
  Effect.tryPromise(() =>
    createBuilder({
      base: "/preview/",
      build: { minify: false, write: false },
      configFile: false,
      environments: {
        ssr: { build: { rolldownOptions: { input: serverEntry } } },
      },
      logLevel: "silent",
      plugins: [fixture(overrideManifest), effectUiPlugin()],
    })
  );

const buildEnvironment = Effect.fn("assets.test.buildEnvironment")(
  function* buildEnvironment(
    builder: Awaited<ReturnType<typeof createBuilder>>,
    name: "client" | "ssr"
  ) {
    const environment = yield* Effect.fromOption(
      Option.fromNullishOr(builder.environments[name])
    );

    return yield* Effect.tryPromise({
      catch: String,
      try: () => builder.build(environment),
    });
  }
);

it.effect("loads dev source URLs without a client build", () =>
  Effect.gen(function* devAssetModule() {
    const server = yield* Effect.acquireRelease(
      Effect.tryPromise(() =>
        createServer({
          configFile: false,
          logLevel: "silent",
          plugins: [effectUiPlugin()],
          server: { middlewareMode: true, ws: false },
        })
      ),
      (running) => Effect.promise(() => running.close())
    );

    const module: unknown = yield* Effect.tryPromise(() =>
      server.ssrLoadModule(assetModule)
    );

    const entries = {
      "all-stars-effect-ui": allStarsEntry,
      "directory-effect-ui": directoryEntry,
      "news-effect-ui": newsEntry,
      "reader-effect-ui": readerEntry,
    };

    for (const [name, entry] of Object.entries(entries)) {
      expect(module).toHaveProperty(`default.${name}`, {
        entryScript: `/${entry}`,
        modulePreloads: [],
        stylesheets: [],
      });
    }
  })
);

it.effect(
  "loads the manifest into the server build without emitting it as an asset",
  () =>
    Effect.gen(function* productionAssetModule() {
      const builder = yield* fixtureBuilder();
      const client = yield* buildEnvironment(builder, "client");

      expect(client).toHaveProperty("output");

      if (!("output" in client)) {
        throw new Error("Expected client bundle files");
      }

      const names = client.output.map(({ fileName }) => fileName);
      expect(names).toHaveLength(4);
      expect(names).not.toContain(".vite/manifest.json");

      const server = yield* buildEnvironment(builder, "ssr");
      expect(server).toHaveProperty("output");

      if (!("output" in server)) {
        throw new Error("Expected server bundle files");
      }

      const chunks = server.output.flatMap((asset) =>
        asset.type === "chunk" ? [asset.code] : []
      );

      expect(chunks).toHaveLength(1);

      for (const name of names) {
        expect(chunks[0]).toContain(`/preview/${name}`);
      }
    })
);

it.effect("reports a server build run before the client manifest exists", () =>
  Effect.gen(function* missingClientBuild() {
    const builder = yield* fixtureBuilder();
    const failure = yield* Effect.flip(buildEnvironment(builder, "ssr"));

    expect(failure).toContain("Effect UI server build has no client manifest");
  })
);

it.effect(
  "rejects missing entries and missing static chunks in the Vite build hook",
  () =>
    Effect.gen(function* invalidManifest() {
      const missingEntry = yield* fixtureBuilder({});

      const entryFailure = yield* Effect.flip(
        buildEnvironment(missingEntry, "client")
      );

      expect(entryFailure).toContain(
        `Missing Effect UI client entry for ${allStarsEntry}`
      );

      const missingChunk = yield* fixtureBuilder({
        [allStarsEntry]: {
          file: "assets/all-stars.js",
          imports: ["_missing.js"],
          isEntry: true,
        },
      });

      const chunkFailure = yield* Effect.flip(
        buildEnvironment(missingChunk, "client")
      );

      expect(chunkFailure).toContain(
        `Effect UI entry ${allStarsEntry} imports missing manifest chunk _missing.js`
      );
    })
);
