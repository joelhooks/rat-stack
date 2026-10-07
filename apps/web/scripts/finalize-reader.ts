import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Schema } from "effect";

import { finalizeReaderHtml } from "../../mischief/scripts/reader-html-head.ts";
import { ReaderInputError } from "../../mischief/scripts/reader-input-error.ts";
import { ReaderFlags } from "../src/client/reader-model.ts";
import { readerMetadataHead } from "../src/reader-metadata.ts";

const program = Effect.gen(function* finalizeReader() {
  const fs = yield* FileSystem.FileSystem;
  const source = yield* fs.readFileString("dist/reader-pages.json");

  const pages = yield* Schema.decodeEffect(
    Schema.fromJsonString(Schema.Array(ReaderFlags))
  )(source);

  yield* Effect.forEach((page: (typeof pages)[number]) =>
    Effect.gen(function* finalizePage() {
      const route = page.page.path;

      if (
        route !== "/" &&
        route !== "/lore/services-capture-dependencies" &&
        route !== "/featured"
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
          ? "dist/client/index.html"
          : `dist/client${route}/index.html`;

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
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
