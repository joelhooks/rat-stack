// @effect-diagnostics-next-line nodeBuiltinImport:off -- This synchronous deploy prop must not require an additional Worker runtime service.
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as Cloudflare from "@alchemy.run/cloudflare";
import { CatalogUnavailable } from "@rat-stack/catalog/Catalog/CatalogUnavailable.rejection";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { CatalogSqlRows, catalogSqlLayer } from "./CatalogSql.ts";
import type { CatalogSql } from "./CatalogSql.ts";
import { catalogWriteFailure } from "./CatalogWriteFailure.ts";

export const catalogMigrationDirectory = (): string =>
  path.relative(
    process.cwd(),
    fileURLToPath(new URL("../../migrations/", import.meta.url))
  );

export const D1CatalogStore = catalogSqlLayer(
  Effect.gen(function* makeD1CatalogStore() {
    const database = yield* Cloudflare.D1.Database(
      "CatalogIndexDatabase",
      Effect.sync(() => ({
        migrations: catalogMigrationDirectory(),
      }))
    );

    const client = yield* Cloudflare.D1.QueryDatabase(database);

    const driver: CatalogSql = {
      query: Effect.fn("D1CatalogStore.query")(
        function* query(operation, statement) {
          const result = yield* client
            .prepare(statement.sql)
            .bind(...statement.parameters)
            .all()
            .pipe(
              Effect.provide(RuntimeContext.phantom),
              Effect.catchCause((cause) =>
                Effect.fail(new CatalogUnavailable({ operation, cause }))
              )
            );

          return yield* Schema.decodeUnknownEffect(CatalogSqlRows)(
            result.results
          ).pipe(
            Effect.mapError(
              (cause) => new CatalogUnavailable({ operation, cause })
            )
          );
        }
      ),
      batch: Effect.fn("D1CatalogStore.batch")(function* batch(statements) {
        yield* client
          .batch(
            statements.map((statement) =>
              client.prepare(statement.sql).bind(...statement.parameters)
            )
          )
          .pipe(
            Effect.provide(RuntimeContext.phantom),
            Effect.catchCause((cause) =>
              Effect.fail(catalogWriteFailure(cause))
            )
          );
      }),
    };

    return driver;
  })
).pipe(Layer.provide(Cloudflare.D1.QueryDatabaseBinding));
