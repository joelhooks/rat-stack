import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Path, Schema } from "effect";

import { PersonIdSchema, RunLog } from "../src/index.js";
import {
  databaseMigrationDirectory,
  databaseSchemaFile,
} from "../src/migrations.js";
import { localD1Layer, localPostgresLayer } from "./local-layers.js";

const personId = Schema.decodeSync(PersonIdSchema)("migration-path-check");

it.effect("loads migrations when the process runs outside the package", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => process.cwd()),
    (originalDirectory) =>
      Effect.gen(function* loadMigrationsFromTemporaryDirectory() {
        yield* Effect.sync(() => {
          process.chdir(tmpdir());
        });

        expect(process.cwd()).not.toBe(originalDirectory);

        const path = yield* Path.Path;

        for (const vendor of ["d1", "postgres"] as const) {
          const migrations = databaseMigrationDirectory(vendor);
          const schema = databaseSchemaFile(vendor);

          expect(path.isAbsolute(migrations)).toBe(false);
          expect(path.isAbsolute(schema)).toBe(false);
          expect(path.resolve(schema)).toBe(
            fileURLToPath(
              new URL(`../src/schema/${vendor}.ts`, import.meta.url)
            )
          );
        }

        const d1Entries = yield* RunLog.pipe(
          Effect.flatMap((runLog) => runLog.listRecent(personId, 1)),
          Effect.provide(localD1Layer)
        );

        const postgresEntries = yield* RunLog.pipe(
          Effect.flatMap((runLog) => runLog.listRecent(personId, 1)),
          Effect.provide(localPostgresLayer)
        );

        expect(d1Entries).toEqual([]);
        expect(postgresEntries).toEqual([]);
      }),
    (originalDirectory) =>
      Effect.sync(() => {
        process.chdir(originalDirectory);
      })
  ).pipe(Effect.provide(NodeServices.layer))
);
