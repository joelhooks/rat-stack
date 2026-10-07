import { fileURLToPath } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Schema } from "effect";
import type { Plugin } from "vite";

import { prepareReader } from "./scripts/reader-build.js";
import { ReaderFlags } from "./src/client/reader-model.js";

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

export const readerPagesPlugin = (): Plugin => ({
  // @effect-diagnostics-next-line asyncFunction:off -- Vite awaits preparation before loading any reader module.
  configResolved: async (config) => {
    await Effect.runPromise(prepareReader(config.root));
  },
  // @effect-diagnostics-next-line asyncFunction:off -- Vite awaits this build-time virtual module boundary.
  load: async (id) =>
    id === "\0virtual:reader-pages"
      ? await Effect.runPromise(preparedPages)
      : null,
  name: "reader-pages",
  resolveId: (id) =>
    id === "virtual:reader-pages" ? "\0virtual:reader-pages" : null,
});
