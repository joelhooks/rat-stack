// @effect-diagnostics-next-line nodeBuiltinImport:off -- Module-evaluation fixtures cannot require a runtime; request IO stays inside the StaticAssets Effect layer.
import { readFileSync } from "node:fs";

import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

import { ContentAssetManifest } from "../src/asset-manifest.js";
import * as runtime from "../src/bundled-content.generated.js";
import {
  ContentCatalog,
  ContentResourceSchema,
  GraphSnapshot,
  LawSource,
  LoreSource,
  SkillSource,
  contentPagePath,
} from "../src/content-data.js";
import { renderStaticDocument } from "../src/html.js";
import { AssetReadError } from "../src/static-assets-error.js";
import { StaticAssets } from "../src/static-assets.js";

export * from "../src/bundled-content.generated.js";

const manifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(ContentAssetManifest)
)(
  readFileSync(
    new URL("../dist/content/manifest.json", import.meta.url),
    "utf-8"
  )
);

if (manifest.generation !== runtime.staticAssetGeneration) {
  throw new Error("Generated fixture and runtime belong to different builds");
}

const assetsRoot = new URL(
  `../dist/content/assets/${manifest.generation}/`,
  import.meta.url
);

const bytes = (path: string) =>
  readFileSync(new URL(path.slice(1), assetsRoot));

export const fixtureBytes = bytes;

export const { handler: fetchFixtureAsset, dispose: disposeFixtureAssets } =
  HttpRouter.toWebHandler(
    HttpRouter.add("GET", "/*", (request) =>
      Effect.sync(() =>
        HttpServerResponse.uint8Array(
          new Uint8Array(
            bytes(new URL(request.url, "https://assets.invalid").pathname)
          )
        )
      )
    ),
    { disableLogger: true }
  );

const documentFor = (route: string) => {
  const page = manifest.pages.find((candidate) => candidate.route === route);

  if (page === undefined) {
    throw new Error(`No generated fixture for ${route}`);
  }

  return bytes(page.html).toString("utf-8");
};

export const generatedReaderPage = (route: string) =>
  renderStaticDocument("https://ratstack.sh", documentFor(route));

export const generatedTokenmaxxPage = renderStaticDocument(
  "https://ratstack.sh",
  runtime.tokenmaxxDocumentHtml
);

export const homeDocumentHtml = documentFor("/");

export const glossaryIndexDocumentHtml = documentFor("/glossary");

export const skillIndexDocumentHtml = documentFor("/skills");

export const loreIndexDocumentHtml = documentFor("/lore");

export const systemsIndexDocumentHtml = documentFor("/systems");

const dataFor = <A>(path: string, schema: Schema.Codec<A, unknown>): A => {
  const envelope = Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({ data: schema, generation: Schema.String })
    )
  )(bytes(path).toString("utf-8"));

  if (envelope.generation !== runtime.staticAssetGeneration) {
    throw new Error("Content fixture belongs to a different generation");
  }

  return envelope.data;
};

export const catalog = dataFor("/_content/catalog.json", ContentCatalog);

export const contentResources = catalog.resources.map((resource) =>
  dataFor(contentPagePath(resource.id), ContentResourceSchema)
);

export const loreGraphSnapshot = dataFor("/_content/graph.json", GraphSnapshot);

export const staticAssetPageRoutes = catalog.pageRoutes;

export const imageAssetPaths = catalog.imagePaths;

export const { homeMarkdownTemplate } = catalog;

export const { glossaryTerms } = catalog;

export const { glossaryIndexMarkdown } = catalog;

export const { skillIndexMarkdown } = catalog;

export const { loreIndexMarkdown } = catalog;

export const { systemsIndexMarkdown } = catalog;

export const { llmsLoreLinks } = catalog;

export const lawSources = contentResources
  .filter((source) => source.kind === "law")
  .map((source) => ({
    ...Schema.decodeUnknownSync(LawSource)(source),
    documentHtml: documentFor(source.routePath),
  }));

export const loreSources = contentResources
  .filter((source) => source.kind === "lore")
  .map((source) => ({
    ...Schema.decodeUnknownSync(LoreSource)(source),
    documentHtml: documentFor(source.routePath),
  }));

export const skillSources = contentResources
  .filter((source) => source.kind === "skill")
  .map((source) => ({
    ...Schema.decodeUnknownSync(SkillSource)(source),
    documentHtml: documentFor(source.routePath),
  }));

export const ratSvg = bytes("/favicon.svg").toString("utf-8");

export const faviconIcoBase64 = bytes("/favicon.ico").toString("base64");

export const appleTouchIconPngBase64 = bytes("/apple-touch-icon.png").toString(
  "base64"
);

export const tokenmaxxImageJpegBase64 = bytes(
  "/tokenmaxx/four-comma-club.jpg"
).toString("base64");

export const cartridgesImageJpegBase64 = bytes(
  "/lore/cartridges/snes-sfam-cartridges.jpg"
).toString("base64");

export const dillonPosterJpegBase64 = bytes(
  "/lore/dependency-injection-is-the-reason-to-choose-effect/dillon-mulroy-di.jpg"
).toString("base64");

export const ogImages = manifest.images
  .filter((path) => path.startsWith("/og/"))
  .map((path) => ({
    pngBase64: bytes(path).toString("base64"),
    routePath: path === "/og/home.png" ? "/" : path.slice(3, -4),
  }));

export const FileAssets = Layer.effect(
  StaticAssets,
  Effect.gen(function* filesystemAssets() {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;

    return StaticAssets.of({
      read: (path) =>
        fs.readFile(paths.join(assetsRoot.pathname, path.slice(1))).pipe(
          Effect.mapError(
            (cause) => new AssetReadError({ cause, path, reason: "provider" })
          ),
          Effect.flatMap((body) =>
            body.byteLength > 0
              ? Effect.succeed(body)
              : Effect.fail(
                  new AssetReadError({
                    cause: "Asset body is empty",
                    path,
                    reason: "empty",
                  })
                )
          )
        ),
    });
  })
).pipe(Layer.provide(NodeServices.layer));
