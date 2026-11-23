import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import { catalogMigrationDirectory } from "../src/Catalog/D1CatalogStore.ts";

it.effect("locates the catalog migration from a cwd-relative directory", () =>
  Effect.gen(function* checkCatalogMigrationPath() {
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const directory = catalogMigrationDirectory();

    const migration = yield* fs.stat(
      path.resolve(directory, "0001_catalog.sql")
    );

    expect(path.isAbsolute(directory)).toBe(false);
    expect(migration.type).toBe("File");
  }).pipe(Effect.provide(NodeServices.layer))
);
