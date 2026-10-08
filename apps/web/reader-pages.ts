import { fileURLToPath } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Schema } from "effect";
import type { Plugin } from "vite";

import { finalizeReaderHtml } from "../mischief/scripts/reader-html-head.ts";
import { ReaderInputError } from "../mischief/scripts/reader-input-error.ts";
import { prepareReader } from "./scripts/reader-build.js";
import { ReaderFlags } from "./src/client/reader-model.js";
import { readerMetadataHead } from "./src/reader-metadata.js";
import { ReaderErrorTemplate } from "./src/server/reader-error-template.js";

const preparedPages = Effect.gen(function* preparedPages() {
  const fs = yield* FileSystem.FileSystem;

  const source = yield* fs.readFileString(
    fileURLToPath(new URL("dist/reader-pages.json", import.meta.url))
  );

  const pages = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Array(ReaderFlags))
  )(source);

  return `export const readerPages = ${JSON.stringify(pages)};`;
}).pipe(Effect.provide(NodeServices.layer));

interface BrowserShellCapture {
  dev?: {
    readonly root: string;
    readonly transform: (html: string) => Promise<string>;
  };
  shell?: string;
}

const preparedErrorModule = Effect.fn("reader.preparedErrorModule")(
  function* preparedErrorModule(capture: BrowserShellCapture) {
    const fs = yield* FileSystem.FileSystem;
    const { dev } = capture;

    const shell =
      capture.shell ??
      (dev === undefined
        ? undefined
        : yield* fs.readFileString(`${dev.root}/index.html`).pipe(
            Effect.flatMap((html) =>
              Effect.tryPromise({
                catch: (cause) =>
                  new ReaderInputError({
                    cause,
                    message:
                      "The dev server cannot transform index.html into the error page shell",
                    sourcePath: "apps/web/index.html",
                  }),
                try: dev.transform.bind(dev, html),
              })
            )
          ));

    if (shell === undefined) {
      return yield* new ReaderInputError({
        message:
          "The error page shell needs the browser build's index.html; build the client environment before the server entry",
        sourcePath: "apps/web/index.html",
      });
    }

    const source = yield* fs.readFileString(
      fileURLToPath(new URL("dist/reader-error.json", import.meta.url))
    );

    const template = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(ReaderErrorTemplate)
    )(source);

    const metadataHead = readerMetadataHead(
      template.page.page.metadata,
      template.page.origin
    );

    if (metadataHead.includes("application/ld+json")) {
      return yield* new ReaderInputError({
        message:
          "The error page head cannot carry structured data; its tokens are filled as attribute text",
        sourcePath: template.page.page.sourcePath,
      });
    }

    const errorShell = yield* Effect.try({
      catch: (cause) =>
        new ReaderInputError({
          cause,
          message:
            "Cannot finalize the error page shell; inspect the browser build's index.html",
          sourcePath: "apps/web/index.html",
        }),
      try: () => finalizeReaderHtml(shell, metadataHead, "index.html"),
    });

    if (dev === undefined) {
      yield* fs.writeFileString(
        fileURLToPath(new URL("dist/reader-error-shell.html", import.meta.url)),
        errorShell
      );
    }

    return [
      `export const readerErrorTemplate = ${JSON.stringify(template)};`,
      `export const readerErrorShell = ${JSON.stringify(errorShell)};`,
    ].join("\n");
  },
  Effect.provide(NodeServices.layer)
);

export const readerPagesPlugin = (): Plugin => {
  const state: BrowserShellCapture = {};

  return {
    // @effect-diagnostics-next-line asyncFunction:off -- Vite awaits preparation before loading any reader module.
    configResolved: async (config) => {
      await Effect.runPromise(prepareReader(config.root));
    },
    configureServer: (server) => {
      state.dev = {
        root: server.config.root,
        // @effect-diagnostics-next-line asyncFunction:off -- Vite's dev server owns this index.html transform Promise.
        transform: async (html) => await server.transformIndexHtml("/", html),
      };
    },
    generateBundle: {
      handler(_options, bundle) {
        const shell = bundle["index.html"];

        if (
          this.environment.name === "client" &&
          shell !== undefined &&
          shell.type === "asset"
        ) {
          state.shell = String(shell.source);
        }
      },
      order: "post",
    },
    // @effect-diagnostics-next-line asyncFunction:off -- Vite awaits this build-time virtual module boundary.
    load: async (id) => {
      if (id === "\0virtual:reader-pages") {
        return await Effect.runPromise(preparedPages);
      }

      return id === "\0virtual:reader-error"
        ? await Effect.runPromise(preparedErrorModule(state))
        : null;
    },
    name: "reader-pages",
    resolveId: (id) =>
      id === "virtual:reader-pages" || id === "virtual:reader-error"
        ? `\0${id}`
        : null,
    sharedDuringBuild: true,
  };
};
