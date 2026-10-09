import { fileURLToPath } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Schema } from "effect";
import type { Plugin } from "vite";

import { finalizeReaderHtml } from "../mischief/scripts/reader-html-head.ts";
import { ReaderInputError } from "../mischief/scripts/reader-input-error.ts";
import { prepareReader } from "./scripts/reader-build.js";
import { ReaderFlags } from "./src/client/reader/model.js";
import { readerMetadataHead } from "./src/reader-metadata.js";
import { isWorkerFirstReaderRoute } from "./src/reader-routes.js";
import { ReaderErrorTemplate } from "./src/server/reader-error-template.js";

const builtPages = Effect.gen(function* builtPages() {
  const fs = yield* FileSystem.FileSystem;

  const source = yield* fs.readFileString(
    fileURLToPath(new URL("dist/reader-pages.json", import.meta.url))
  );

  return yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Array(ReaderFlags))
  )(source);
});

const preparedPages = builtPages.pipe(
  Effect.flatMap(
    Schema.encodeEffect(Schema.fromJsonString(Schema.Array(ReaderFlags)))
  ),
  Effect.map((pages) => `export const readerPages = ${pages};`),
  Effect.provide(NodeServices.layer)
);

interface BrowserShellCapture {
  defaultOutput?: boolean;
  dev?: {
    readonly root: string;
    readonly transform: (html: string) => Promise<string>;
  };
  shell?: string;
}

const browserShell = Effect.fn("reader.browserShell")(function* browserShell(
  capture: BrowserShellCapture
) {
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
                    "The dev server cannot transform index.html into a reader page shell",
                  sourcePath: "apps/web/index.html",
                }),
              try: dev.transform.bind(dev, html),
            })
          )
        ));

  if (shell === undefined) {
    return yield* new ReaderInputError({
      message:
        "Reader page shells need the browser build's index.html; build the client environment before the server entry",
      sourcePath: "apps/web/index.html",
    });
  }

  return shell;
});

const finishedShell = (
  shell: string,
  metadataHead: string,
  sourcePath: string
) =>
  Effect.try({
    catch: (cause) =>
      new ReaderInputError({
        cause,
        message:
          "Cannot finalize a reader page shell; inspect the browser build's index.html",
        sourcePath,
      }),
    try: () => finalizeReaderHtml(shell, metadataHead, "index.html"),
  });

const preparedShellModule = Effect.fn("reader.preparedShellModule")(
  function* preparedShellModule(capture: BrowserShellCapture) {
    const fs = yield* FileSystem.FileSystem;
    const shell = yield* browserShell(capture);
    const pages = yield* builtPages;

    const shells = yield* Effect.forEach(
      pages.filter((page) => isWorkerFirstReaderRoute(page.page.path)),
      (page) =>
        finishedShell(
          shell,
          readerMetadataHead(page.page.metadata, page.origin),
          page.page.sourcePath
        ).pipe(Effect.map((html) => [page.page.path, html] as const))
    );

    const source = JSON.stringify(Object.fromEntries(shells));

    if (capture.dev === undefined && capture.defaultOutput === true) {
      yield* fs.writeFileString(
        fileURLToPath(new URL("dist/reader-page-shells.json", import.meta.url)),
        source
      );
    }

    return `export const readerPageShells = ${source};`;
  },
  Effect.provide(NodeServices.layer)
);

const preparedErrorModule = Effect.fn("reader.preparedErrorModule")(
  function* preparedErrorModule(capture: BrowserShellCapture) {
    const fs = yield* FileSystem.FileSystem;
    const { dev } = capture;
    const shell = yield* browserShell(capture);

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

    const errorShell = yield* finishedShell(
      shell,
      metadataHead,
      template.page.page.sourcePath
    );

    if (dev === undefined && capture.defaultOutput === true) {
      yield* fs.writeFileString(
        fileURLToPath(new URL("dist/reader-error-shell.html", import.meta.url)),
        errorShell
      );
    }

    const encodedTemplate = yield* Schema.encodeEffect(
      Schema.fromJsonString(ReaderErrorTemplate)
    )(template);

    return [
      `export const readerErrorTemplate = ${encodedTemplate};`,
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
      const output = (directory: string) =>
        new URL(`${directory}/`, `file://${config.root}/`).pathname;

      state.defaultOutput =
        output(config.build.outDir) === output("dist/client");
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

      if (id === "\0virtual:reader-shells") {
        return await Effect.runPromise(preparedShellModule(state));
      }

      return id === "\0virtual:reader-error"
        ? await Effect.runPromise(preparedErrorModule(state))
        : null;
    },
    name: "reader-pages",
    resolveId: (id) =>
      id === "virtual:reader-pages" ||
      id === "virtual:reader-error" ||
      id === "virtual:reader-shells"
        ? `\0${id}`
        : null,
    sharedDuringBuild: true,
  };
};
