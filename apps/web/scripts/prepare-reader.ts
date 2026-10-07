import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Effect, FileSystem, Option, Schema } from "effect";

import { readerHomeFlags } from "../../mischief/scripts/reader-home-flags.ts";
import { ReaderInputError } from "../../mischief/scripts/reader-input-error.ts";
import { readerPrototypeFlags } from "../../mischief/scripts/reader-prototype-flags.ts";
import { featuredSites } from "../../mischief/src/capabilities/featured-sites.ts";
import { featuredSpec } from "../src/client/featured.ts";
import { ReaderFlags } from "../src/client/reader-model.ts";
import { serviceCaptureDocument } from "../src/client/service-capture-document.ts";

const readerPages = Effect.gen(function* readerPages() {
  const previewCommit = yield* Config.option(
    Config.schema(
      Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/u)),
      "PREVIEW_COMMIT"
    )
  );

  const previewOrigin = yield* Config.option(Config.String("PREVIEW_ORIGIN"));

  if (Option.isSome(previewCommit) && Option.isNone(previewOrigin)) {
    return yield* Effect.die(
      new Error(
        "A preview reader build requires PREVIEW_ORIGIN; production canonicals are forbidden"
      )
    );
  }

  const origin = Option.getOrElse(previewOrigin, () => "https://ratstack.sh");

  const parsedOrigin = yield* Effect.try({
    catch: (cause) =>
      new ReaderInputError({
        cause,
        message: "PREVIEW_ORIGIN must be an HTTPS origin without a path",
        sourcePath: ".env.schema",
      }),
    try: () => new URL(origin),
  });

  if (
    parsedOrigin.protocol !== "https:" ||
    parsedOrigin.origin !== origin ||
    (Option.isSome(previewCommit) &&
      !/^https:\/\/pr-[1-9]\d*\.ratstack\.sh$/u.test(origin))
  ) {
    return yield* Effect.die(
      new Error(
        "Reader origin is invalid; use https://pr-<number>.ratstack.sh for a preview"
      )
    );
  }

  const home = yield* readerHomeFlags(origin);
  const lore = yield* readerPrototypeFlags(origin);
  const sites = yield* featuredSites.handler({});

  const featured = {
    ...home,
    bibliography: [],
    blocks: [],
    codeFences: [],
    copyPrompts: [],
    featured: { featuredSites: sites, showNote: true, spec: featuredSpec },
    heading: "Built with rat-stack",
    page: {
      ...home.page,
      metadata: {
        ...home.page.metadata,
        canonicalPath: "/featured",
        description: "Sites built with rat-stack.",
        discoveryLinks: [],
        jsonLd: "none",
        title: "Featured sites | rat-stack",
      },
      path: "/featured",
      sourcePath: ".brain/data/featured-sites.json",
    },
    snippets: [],
    terms: [],
  };

  const pages = [home, { ...lore, blocks: serviceCaptureDocument }, featured];

  return yield* Effect.forEach((page: (typeof pages)[number]) =>
    Schema.decodeUnknownEffect(ReaderFlags)({
      ...page,
      page: {
        ...page.page,
        metadata: {
          ...page.page.metadata,
          robots: Option.isSome(previewCommit)
            ? "noindex"
            : page.page.metadata.robots,
        },
      },
    })
  )(pages);
}).pipe(Effect.provide(NodeServices.layer));

const program = Effect.gen(function* prepareReader() {
  const fs = yield* FileSystem.FileSystem;
  const pages = yield* readerPages;

  const encoded = yield* Schema.encodeEffect(
    Schema.fromJsonString(Schema.Array(ReaderFlags))
  )(pages);

  yield* fs.makeDirectory("dist", { recursive: true });
  yield* fs.writeFileString("dist/reader-pages.json", encoded);
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
