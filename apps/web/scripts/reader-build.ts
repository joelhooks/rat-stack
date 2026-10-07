import { NodeServices } from "@effect/platform-node";
import { Config, Effect, FileSystem, Option, Schema } from "effect";

import { readerHomeFlags } from "../../mischief/scripts/reader-home-flags.ts";
import { finalizeReaderHtml } from "../../mischief/scripts/reader-html-head.ts";
import { ReaderInputError } from "../../mischief/scripts/reader-input-error.ts";
import { readerPrototypeFlags } from "../../mischief/scripts/reader-prototype-flags.ts";
import { readerSystemsSkillsFlags } from "../../mischief/scripts/reader-systems-skills-flags.ts";
import { isSystemsSkillsRoute } from "../../mischief/scripts/reader-systems-skills-routes.ts";
import { ReaderFlags } from "../src/client/reader-model.ts";
import { serviceCaptureDocument } from "../src/client/service-capture-document.ts";
import { readerMetadataHead } from "../src/reader-metadata.ts";

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
  const lore = yield* readerPrototypeFlags(origin);
  const systemsSkills = yield* readerSystemsSkillsFlags(origin);

  const pages = [
    home,
    { ...lore, blocks: serviceCaptureDocument },
    ...systemsSkills,
  ];

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

    yield* Effect.forEach((page: (typeof pages)[number]) =>
      Effect.gen(function* finalizePage() {
        const route = page.page.path;

        if (
          route !== "/" &&
          route !== "/lore/services-capture-dependencies" &&
          !isSystemsSkillsRoute(route)
        ) {
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
