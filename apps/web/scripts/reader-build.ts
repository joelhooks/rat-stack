import { NodeServices } from "@effect/platform-node";
import { Config, Effect, FileSystem, Option, Schema } from "effect";

import { readerHomeFlags } from "../../mischief/scripts/reader-home-flags.ts";
import { finalizeReaderHtml } from "../../mischief/scripts/reader-html-head.ts";
import { ReaderInputError } from "../../mischief/scripts/reader-input-error.ts";
import { readerLearnFlags } from "../../mischief/scripts/reader-learn-flags.ts";
import { readerLoreFlags } from "../../mischief/scripts/reader-lore-flags.ts";
import { readerPromptFlags } from "../../mischief/scripts/reader-prompt-flags.ts";
import { ReaderFlags } from "../src/client/reader-model.ts";
import { readerMetadataHead } from "../src/reader-metadata.ts";
import { isReaderRoutePath } from "../src/reader-routes.ts";
import { copyReaderAssets } from "./reader-assets.ts";

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

  const origin = Option.isSome(previewCommit)
    ? Option.getOrElse(previewOrigin, () => "https://ratstack.sh")
    : "https://ratstack.sh";

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
  const lore = yield* readerLoreFlags(origin);
  const prompts = yield* readerPromptFlags(origin);
  const learn = yield* readerLearnFlags(origin);
  const pages = [home, ...lore, learn, ...prompts];

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

export const prepareReader = Effect.fn("reader.prepare")(
  function* prepareReader(root: string) {
    const fs = yield* FileSystem.FileSystem;
    const pages = yield* readerPages;

    const encoded = yield* Schema.encodeEffect(
      Schema.fromJsonString(Schema.Array(ReaderFlags))
    )(pages);

    yield* fs.makeDirectory(`${root}/dist`, { recursive: true });
    yield* fs.writeFileString(`${root}/dist/reader-pages.json`, encoded);
  },
  Effect.provide(NodeServices.layer)
);

export const finalizeReader = Effect.fn("reader.finalize")(
  function* finalizeReader(root: string, clientDirectory: string) {
    const fs = yield* FileSystem.FileSystem;
    const source = yield* fs.readFileString(`${root}/dist/reader-pages.json`);

    const pages = yield* Schema.decodeEffect(
      Schema.fromJsonString(Schema.Array(ReaderFlags))
    )(source);

    yield* copyReaderAssets(
      pages,
      clientDirectory,
      `${root}/dist/reader-pages.json`
    );

    yield* Effect.forEach((page: (typeof pages)[number]) =>
      Effect.gen(function* finalizePage() {
        const route = page.page.path;

        if (!isReaderRoutePath(route)) {
          return yield* Effect.fail(
            new ReaderInputError({
              message:
                "Reader finalization refuses an out-of-slice page; update the route ledger before adding it",
              sourcePath: route,
            })
          );
        }

        const path =
          route === "/"
            ? `${clientDirectory}/index.html`
            : `${clientDirectory}${route}/index.html`;

        const html = yield* fs.readFileString(path);

        const finalized = yield* Effect.try({
          catch: (cause) =>
            new ReaderInputError({
              cause,
              message:
                "Cannot finalize the reader head; inspect the Foldkit prerender output",
              sourcePath: path,
            }),
          try: () =>
            finalizeReaderHtml(
              html,
              readerMetadataHead(page.page.metadata, page.origin),
              path
            ),
        });

        return yield* fs.writeFileString(path, finalized);
      })
    )(pages);

    const commit = yield* Config.option(
      Config.schema(
        Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/u)),
        "PREVIEW_COMMIT"
      )
    );

    const headerPath = `${clientDirectory}/_headers`;

    if (Option.isSome(commit)) {
      if (
        !pages.every(
          (page) =>
            /^https:\/\/pr-[1-9]\d*\.ratstack\.sh$/u.test(page.origin) &&
            page.page.metadata.robots === "noindex"
        )
      ) {
        return yield* new ReaderInputError({
          message:
            "Preview asset headers require preview-only pages and canonicals",
          sourcePath: headerPath,
        });
      }

      return yield* fs.writeFileString(
        headerPath,
        `/*\n  X-Robots-Tag: noindex\n  X-Preview-Commit: ${commit.value}\n`
      );
    }

    return yield* fs.remove(headerPath, { force: true });
  },
  Effect.provide(NodeServices.layer)
);
