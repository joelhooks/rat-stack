import { NodeServices } from "@effect/platform-node";
import { Config, Effect, FileSystem, Option, Schema } from "effect";

import { readerBodyFlags } from "../../mischief/scripts/reader-body-flags.ts";
import { readerCafeFlags } from "../../mischief/scripts/reader-cafe-flags.ts";
import { readerErrorTemplate } from "../../mischief/scripts/reader-error-flags.ts";
import { readerHomeFlags } from "../../mischief/scripts/reader-home-flags.ts";
import { finalizeReaderHtml } from "../../mischief/scripts/reader-html-head.ts";
import { ReaderInputError } from "../../mischief/scripts/reader-input-error.ts";
import { readerLearnFlags } from "../../mischief/scripts/reader-learn-flags.ts";
import { readerLoreFlags } from "../../mischief/scripts/reader-lore-flags.ts";
import { readerPromptFlags } from "../../mischief/scripts/reader-prompt-flags.ts";
import { readerSystemsSkillsFlags } from "../../mischief/scripts/reader-systems-skills-flags.ts";
import { ReaderFlags } from "../src/client/reader/model.ts";
import type { ReaderPageFlags } from "../src/client/reader/model.ts";
import { readerMetadataHead } from "../src/reader-metadata.ts";
import {
  isReaderRoutePath,
  readerNoStoreRoutePaths,
} from "../src/reader-routes.ts";
import { ReaderErrorTemplate } from "../src/server/reader-error-template.ts";
import { copyReaderAssets } from "./reader-assets.ts";

const encodeFlags = Effect.forEach((page: ReaderPageFlags) =>
  Schema.encodeEffect(ReaderFlags)(page)
);

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
  const lore = yield* Effect.flatMap(readerLoreFlags(origin), encodeFlags);
  const prompts = yield* readerPromptFlags(origin);
  const learn = yield* readerLearnFlags(origin);
  const bodies = yield* Effect.flatMap(readerBodyFlags(origin), encodeFlags);
  const systemsSkills = yield* readerSystemsSkillsFlags(origin);

  const cafe = yield* readerCafeFlags(origin);

  const pages = [
    home,
    ...lore,
    learn,
    ...prompts,
    ...cafe,
    ...systemsSkills,
    ...bodies,
  ];

  const error = yield* readerErrorTemplate(origin);

  const decoded = yield* Effect.forEach((page: (typeof pages)[number]) =>
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

  return { error, pages: decoded };
}).pipe(Effect.provide(NodeServices.layer));

export const prepareReader = Effect.fn("reader.prepare")(
  function* prepareReader(root: string) {
    const fs = yield* FileSystem.FileSystem;
    const { error, pages } = yield* readerPages;

    const encoded = yield* Schema.encodeEffect(
      Schema.fromJsonString(Schema.Array(ReaderFlags))
    )(pages);

    const encodedError = yield* Schema.encodeEffect(
      Schema.fromJsonString(ReaderErrorTemplate)
    )(error);

    yield* fs.makeDirectory(`${root}/dist`, { recursive: true });
    yield* fs.writeFileString(`${root}/dist/reader-pages.json`, encoded);
    yield* fs.writeFileString(`${root}/dist/reader-error.json`, encodedError);
  },
  Effect.provide(NodeServices.layer)
);

const readerRouteHeaders = (
  pages: readonly ReaderPageFlags[],
  production: boolean
) =>
  pages
    .map((page) => {
      const lines = [
        ...(readerNoStoreRoutePaths.includes(page.page.path)
          ? ["  Cache-Control: no-store"]
          : []),
        ...(production && page.page.metadata.robots === "noindex"
          ? ["  X-Robots-Tag: noindex"]
          : []),
      ];

      return lines.length === 0
        ? ""
        : `${page.page.path}\n${lines.join("\n")}\n`;
    })
    .join("");

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
        `/*\n  X-Robots-Tag: noindex\n  X-Preview-Commit: ${commit.value}\n${readerRouteHeaders(pages, false)}`
      );
    }

    const routeHeaders = readerRouteHeaders(pages, true);

    return yield* routeHeaders === ""
      ? fs.remove(headerPath, { force: true })
      : fs.writeFileString(headerPath, routeHeaders);
  },
  Effect.provide(NodeServices.layer)
);
