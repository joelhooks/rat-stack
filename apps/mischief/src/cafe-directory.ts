import { CafeDirectory } from "@rat-stack/core";
import { Effect, Layer } from "effect";

import { ContentStore } from "./content-store.js";

export const cafeDirectoryLayer = Layer.effect(
  CafeDirectory,
  Effect.gen(function* makeCafeDirectory() {
    const store = yield* ContentStore;

    return CafeDirectory.of({ data: store.cafe });
  })
);
