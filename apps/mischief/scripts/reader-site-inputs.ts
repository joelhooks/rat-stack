import { Prompt } from "@rat-stack/core/contracts";
import { Effect, FileSystem, Path, Schema } from "effect";
import { DomUtils, parseDocument } from "htmlparser2";

import { ReaderReferences } from "../../web/src/page-descriptor.ts";
import { ContentAssetManifest } from "../src/asset-manifest.ts";
import {
  staticAssetGeneration,
  tokenmaxxDocumentHtml,
} from "../src/bundled-content.generated.ts";
import { ContentCatalog } from "../src/content-data.ts";
import { markdownDiscoveryLinks } from "../src/content-links.ts";
import { parseLorePage } from "./content-lib.ts";
import { ReaderInputError } from "./reader-input-error.ts";
import { contentDates } from "./seo-metadata.ts";

const envelope = Schema.Struct({
  data: ContentCatalog,
  generation: Schema.String,
});

const readerSource = Schema.Struct({
  generation: Schema.String,
  home: Schema.String,
  loreTermTargets: Schema.Array(
    Schema.Struct({ routePath: Schema.String, term: Schema.String })
  ),
  prompts: Schema.Array(
    Schema.Struct({ ...Prompt.fields, sourcePath: Schema.String })
  ),
  references: ReaderReferences,
});

const indexSources = new Map([
  ["/", "VISION.md"],
  ["/lore", ".brain/resources/lore"],
  ["/systems", ".brain/areas"],
  ["/skills", "skills"],
  ["/glossary", ".brain/resources/lore"],
]);

const jsonLdPolicy = (path: string) => {
  if (path === "/") {
    return "WebSite";
  }

  return path.startsWith("/lore/") || path.startsWith("/systems/")
    ? "TechArticle"
    : "none";
};

export const documentMetadata = (path: string, html: string) => {
  const document = parseDocument(html);
  const tags = DomUtils.getElementsByTagName("meta", document.children);
  const title = DomUtils.getElementsByTagName("title", document.children).at(0);

  const description = tags.find((tag) => tag.attribs.name === "description")
    ?.attribs.content;

  const image = tags.find((tag) => tag.attribs.property === "og:image")?.attribs
    .content;

  if (title === undefined || description === undefined || image === undefined) {
    throw new Error(`Reader metadata is incomplete at ${path}`);
  }

  const structuredData = DomUtils.getElementsByTagName(
    "script",
    document.children
  ).find((element) => element.attribs.type === "application/ld+json");

  const dates =
    structuredData === undefined
      ? {}
      : Schema.decodeUnknownSync(
          Schema.fromJsonString(
            Schema.Struct({
              dateModified: Schema.optional(Schema.String),
              datePublished: Schema.optional(Schema.String),
            })
          )
        )(DomUtils.textContent(structuredData));

  return {
    ...dates,
    canonicalPath: path,
    description,
    discoveryLinks: markdownDiscoveryLinks(path),
    jsonLd: jsonLdPolicy(path),
    ogImagePath: image.replace("__RATSTACK_ORIGIN__", ""),
    robots: tags.some(
      (tag) =>
        tag.attribs.name === "robots" && tag.attribs.content === "noindex"
    )
      ? "noindex"
      : "index",
    title: DomUtils.textContent(title),
  };
};

export const readerAssetInputs = Effect.gen(function* readerAssetInputs() {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const root = new URL("../dist/content/", import.meta.url).pathname;

  const manifest = yield* fs
    .readFileString(paths.join(root, "manifest.json"))
    .pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.fromJsonString(ContentAssetManifest))
      )
    );

  return {
    directory: paths.join(root, "assets", manifest.generation),
    documents: paths.join(root, "documents", manifest.generation),
    manifest,
  };
});

export const prepareReaderSiteInputs = Effect.gen(
  function* prepareReaderSiteInputs() {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const repository = new URL("../../../", import.meta.url).pathname;
    const { directory, documents, manifest } = yield* readerAssetInputs;

    const catalog = yield* fs
      .readFileString(paths.join(directory, "_content/catalog.json"))
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(Schema.fromJsonString(envelope))
        )
      );

    if (catalog.generation !== manifest.generation) {
      return yield* Effect.die(
        new Error("Reader inputs and catalog generations differ")
      );
    }

    const resourceFor = (route: string) =>
      catalog.data.resources.find((resource) => resource.routePath === route);

    const readPage = (entry: (typeof manifest.pages)[number]) =>
      fs.readFileString(paths.join(documents, entry.document.slice(1))).pipe(
        Effect.flatMap((html) =>
          Effect.try({
            catch: (cause) =>
              new ReaderInputError({
                cause,
                message: `Cannot read page descriptor at ${entry.route}; regenerate its HTML metadata`,
                sourcePath: entry.route,
              }),
            try: () => ({
              html,
              metadata: documentMetadata(entry.route, html),
              path: entry.route,
              sourcePath:
                resourceFor(entry.route)?.sourcePath ??
                indexSources.get(entry.route) ??
                "apps/mischief/scripts/generate-content.ts",
              status: 200,
            }),
          })
        )
      );

    const manifestPages = yield* Effect.forEach(readPage)(manifest.pages);

    if (staticAssetGeneration !== manifest.generation) {
      return yield* new ReaderInputError({
        message:
          "The bundled tokenmaxx document and the content manifest have different generations; regenerate content before building the reader",
        sourcePath: "apps/mischief/src/bundled-content.generated.ts",
      });
    }

    const tokenmaxxHtml = tokenmaxxDocumentHtml;

    const pages = [
      ...manifestPages,
      {
        html: tokenmaxxHtml,
        metadata: documentMetadata("/tokenmaxx", tokenmaxxHtml),
        path: "/tokenmaxx",
        sourcePath: "apps/mischief/content/tokenmaxx.md",
        status: 200,
      },
    ];

    const source = yield* fs
      .readFileString(
        new URL("../dist/reader-source.json", import.meta.url).pathname
      )
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(Schema.fromJsonString(readerSource))
        )
      );

    if (source.generation !== manifest.generation) {
      return yield* Effect.die(
        new Error("Reader source and manifest generations differ")
      );
    }

    const sourcePath =
      ".brain/resources/lore/services-capture-dependencies.svx";

    const raw = yield* fs.readFileString(paths.join(repository, sourcePath));

    const lore = yield* Effect.try({
      catch: (cause) =>
        new ReaderInputError({
          cause,
          message:
            "Cannot decode the hand-converted lore source; repair its frontmatter or body",
          sourcePath,
        }),
      try: () => ({
        ...parseLorePage(sourcePath, raw),
        ...contentDates(raw, sourcePath),
      }),
    });

    return {
      directory,
      generation: manifest.generation,
      homeSource: source.home,
      images: manifest.images,
      lore,
      loreTermTargets: source.loreTermTargets,
      pages,
      prompts: source.prompts,
      references: source.references,
    };
  }
);
