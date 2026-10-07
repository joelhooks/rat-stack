import { Effect, FileSystem, Path, Schema } from "effect";
import { DomUtils, parseDocument } from "htmlparser2";

import { ReaderReferences } from "../../web/src/page-descriptor.ts";
import { ContentAssetManifest } from "../src/asset-manifest.ts";
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

const documentMetadata = (path: string, html: string) => {
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

  return {
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

export const prepareReaderSiteInputs = Effect.gen(
  function* prepareReaderSiteInputs() {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const root = new URL("../dist/content/", import.meta.url).pathname;
    const repository = new URL("../../../", import.meta.url).pathname;

    const manifest = yield* fs
      .readFileString(paths.join(root, "manifest.json"))
      .pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.fromJsonString(ContentAssetManifest)
          )
        )
      );

    const directory = paths.join(root, "assets", manifest.generation);

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
      fs.readFileString(paths.join(directory, entry.html.slice(1))).pipe(
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

    const pages = yield* Effect.forEach(readPage)(manifest.pages);

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
      lore,
      loreTermTargets: source.loreTermTargets,
      pages,
      references: source.references,
    };
  }
);
