import { DatabaseSync } from "node:sqlite";

import { NodeServices } from "@effect/platform-node";
import { CatalogStore } from "@rat-stack/catalog/Catalog/CatalogStore";
import { CatalogUnavailable } from "@rat-stack/catalog/Catalog/CatalogUnavailable.rejection";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { CatalogSqlRows, catalogSqlLayer } from "../src/Catalog/CatalogSql.ts";
import type { CatalogSql } from "../src/Catalog/CatalogSql.ts";

const catalogMigrationDirectory = new URL("../migrations/", import.meta.url)
  .pathname;

export const sqliteCatalogFixture = Effect.gen(
  function* sqliteCatalogFixture() {
    const fs = yield* FileSystem.FileSystem;

    const database = yield* Effect.acquireRelease(
      Effect.sync(() => new DatabaseSync(":memory:")),
      (db) =>
        Effect.sync(() => {
          db.close();
        })
    );

    const migrations = (yield* fs.readDirectory(catalogMigrationDirectory))
      .filter((file) => file.endsWith(".sql"))
      .toSorted();

    for (const name of migrations) {
      const sql = yield* fs.readFileString(
        `${catalogMigrationDirectory}/${name}`
      );

      yield* Effect.sync(() => {
        database.exec(sql);
      });
    }

    const driver: CatalogSql = {
      query: Effect.fn("SqliteCatalog.query")(
        function* query(operation, statement) {
          const rows = yield* Effect.try({
            try: () => {
              const prepared = database.prepare(statement.sql);
              prepared.setReadBigInts(true);

              return prepared
                .all(...statement.parameters)
                .map((row) =>
                  Object.fromEntries(
                    Object.entries(row).map(([key, value]) => [
                      key,
                      Schema.is(Schema.BigInt)(value) ? Number(value) : value,
                    ])
                  )
                );
            },
            catch: (cause) => new CatalogUnavailable({ operation, cause }),
          });

          return yield* Schema.decodeUnknownEffect(CatalogSqlRows)(rows).pipe(
            Effect.mapError(
              (cause) => new CatalogUnavailable({ operation, cause })
            )
          );
        }
      ),
      batch: (statements) =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            database.exec("BEGIN");
          }),
          () =>
            Effect.gen(function* writeBatch() {
              for (const statement of statements) {
                yield* Effect.sync(() => {
                  database.prepare(statement.sql).run(...statement.parameters);
                });
              }
            }),
          (_, exit) =>
            Effect.sync(() => {
              database.exec(Exit.isSuccess(exit) ? "COMMIT" : "ROLLBACK");
            })
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.fail(new CatalogUnavailable({ operation: "record", cause }))
          )
        ),
    };

    const context = yield* Layer.build(catalogSqlLayer(Effect.succeed(driver)));
    const store = Context.get(context, CatalogStore);

    return { database, store };
  }
);

export const SqliteCatalog = Layer.effect(
  CatalogStore,
  sqliteCatalogFixture.pipe(Effect.map(({ store }) => store))
).pipe(Layer.provide(NodeServices.layer));
