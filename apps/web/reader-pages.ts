import { fileURLToPath } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Schema } from "effect";
import type { Plugin } from "vite";

import { prepareReader } from "./scripts/reader-build.js";
import { ReaderFlags } from "./src/client/reader/model.js";
import { ReaderErrorTemplate } from "./src/server/reader-error-template.js";

const preparedPages = Effect.gen(function* preparedPages() {
  const fs = yield* FileSystem.FileSystem;

  const source = yield* fs.readFileString(
    fileURLToPath(new URL("dist/reader-pages.json", import.meta.url))
  );

  const pages = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Array(ReaderFlags))
  )(source);

  const encoded = yield* Schema.encodeEffect(
    Schema.fromJsonString(Schema.Array(ReaderFlags))
  )(pages);

  return `export const readerPages = ${encoded};`;
}).pipe(Effect.provide(NodeServices.layer));

const preparedError = Effect.gen(function* preparedError() {
  const fs = yield* FileSystem.FileSystem;

  const source = yield* fs.readFileString(
    fileURLToPath(new URL("dist/reader-error.json", import.meta.url))
  );

  const template = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(ReaderErrorTemplate)
  )(source);

  const encoded = yield* Schema.encodeEffect(
    Schema.fromJsonString(ReaderErrorTemplate)
  )(template);

  return `export const readerErrorTemplate = ${encoded};`;
}).pipe(Effect.provide(NodeServices.layer));

export const readerPagesPlugin = (): Plugin => ({
  // @effect-diagnostics-next-line asyncFunction:off -- Vite awaits preparation before loading any reader module.
  configResolved: async (config) => {
    await Effect.runPromise(prepareReader(config.root));
  },
  // @effect-diagnostics-next-line asyncFunction:off -- Vite awaits this build-time virtual module boundary.
  load: async (id) => {
    if (id === "\0virtual:reader-pages") {
      return await Effect.runPromise(preparedPages);
    }

    return id === "\0virtual:reader-error"
      ? await Effect.runPromise(preparedError)
      : null;
  },
  name: "reader-pages",
  resolveId: (id) =>
    id === "virtual:reader-pages" || id === "virtual:reader-error"
      ? `\0${id}`
      : null,
  sharedDuringBuild: true,
});
