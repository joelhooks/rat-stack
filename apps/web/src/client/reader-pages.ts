import { Effect, Option, Schema } from "effect";
import { readerPagePaths } from "virtual:reader-pages";

import { ReaderFlags } from "./reader/model.js";
import type { ReaderPageFlags } from "./reader/model.js";

export const pagePaths = Schema.decodeUnknownSync(Schema.Array(Schema.String))(
  readerPagePaths
);

const decodeSources = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Tuple([Schema.String, Schema.String]))
);

const decodePage = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ReaderFlags)
);

// @effect-diagnostics-next-line asyncFunction:off -- the lazy chunk boundary is a dynamic import
const importSources = async () => await import("virtual:reader-page-sources");

const loadSources = Effect.fn("reader.loadPageSources")(
  function* loadSources() {
    const loaded = yield* Effect.promise(importSources);

    return yield* decodeSources(loaded.readerPageSources);
  }
);

const decoded = new Map<string, ReaderPageFlags>();

export const findPage = Effect.fn("reader.findPage")(function* findPage(
  path: string
) {
  const cached = decoded.get(path);

  if (cached !== undefined) {
    return Option.some(cached);
  }

  const found = (yield* loadSources()).find(
    ([candidate]) => candidate === path
  );

  if (found === undefined) {
    return Option.none();
  }

  const page = yield* decodePage(found[1]);
  decoded.set(path, page);

  return Option.some(page);
});
