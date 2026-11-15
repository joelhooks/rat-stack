import * as Cloudflare from "@alchemy.run/cloudflare";
import { CatalogUnavailable } from "@rat-stack/catalog/Catalog/CatalogUnavailable.rejection";
import { retain } from "alchemy/RemovalPolicy";
import { RuntimeContext } from "alchemy/RuntimeContext";
import { Stage } from "alchemy/Stage";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { CatalogSqlRows, catalogSqlLayer } from "./CatalogSql.ts";
import type { CatalogSql } from "./CatalogSql.ts";

export const catalogMigrationDirectory = new URL(
  "../../migrations/",
  import.meta.url
).pathname;

export const D1CatalogStore = catalogSqlLayer(
  Effect.gen(function* makeD1CatalogStore() {
    const database = yield* Cloudflare.D1.Database("CatalogIndexDatabase", {
      migrations: catalogMigrationDirectory,
    }).pipe(retain(Stage.pipe(Effect.map((stage) => stage === "prod"))));

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
              Effect.fail(
                new CatalogUnavailable({ operation: "record", cause })
              )
            )
          );
      }),
    };

    return driver;
  })
).pipe(Layer.provide(Cloudflare.D1.QueryDatabaseBinding));
