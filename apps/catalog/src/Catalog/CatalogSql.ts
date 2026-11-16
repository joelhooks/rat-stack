import {
  authorIdentityKey,
  normalizeAuthor,
} from "@rat-stack/catalog/Catalog/AuthorIdentity";
import {
  catalogPage,
  risingScope,
  repeatAuthorsScope,
  readCatalogCursor,
  validateCatalogPage,
} from "@rat-stack/catalog/Catalog/CatalogPaging";
import { CatalogStore } from "@rat-stack/catalog/Catalog/CatalogStore";
import { CatalogUnavailable } from "@rat-stack/catalog/Catalog/CatalogUnavailable.rejection";
import {
  CatalogEventRow,
  editorialDecisionOf,
  RepeatAuthorEntry,
  RisingEntry,
  validateCatalogRows,
  validateRepeatAuthorsInput,
  validateRisingInput,
} from "@rat-stack/catalog/Catalog/CatalogValues";
import type { InvalidCatalogInput } from "@rat-stack/catalog/Catalog/InvalidCatalogInput.rejection";
import { Effect } from "effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

export const CatalogSqlRows = Schema.Array(
  Schema.Record(
    Schema.String,
    Schema.NullOr(Schema.Union([Schema.String, Schema.Finite]))
  )
);

export type CatalogSqlValue = string | number | null;

export interface CatalogSqlStatement {
  readonly sql: string;
  readonly parameters: readonly CatalogSqlValue[];
}

export interface CatalogSql {
  readonly query: (
    operation: "rising" | "repeatAuthors",
    statement: CatalogSqlStatement
  ) => Effect.Effect<typeof CatalogSqlRows.Type, CatalogUnavailable>;
  readonly batch: (
    statements: readonly CatalogSqlStatement[]
  ) => Effect.Effect<void, CatalogUnavailable | InvalidCatalogInput>;
}

export const risingSql = (metric: "stars" | "views") => `
WITH ranked AS (
  SELECT item_id, kind, source, observed_at, ${metric} AS metric_value,
    FIRST_VALUE(${metric}) OVER (PARTITION BY item_id, source ORDER BY observed_at, seq, id) AS first_value,
    FIRST_VALUE(observed_at) OVER (PARTITION BY item_id, source ORDER BY observed_at, seq, id) AS first_at,
    ROW_NUMBER() OVER (PARTITION BY item_id, source ORDER BY observed_at DESC, seq DESC, id DESC) AS position,
    COUNT(*) OVER (PARTITION BY item_id, source) AS samples
  FROM catalog_events
  WHERE observed_at >= ? AND observed_at < ? AND ${metric} IS NOT NULL
), candidates AS (
  SELECT *, metric_value - first_value AS gain,
    ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY metric_value - first_value DESC, source) AS chosen
  FROM ranked WHERE position = 1 AND samples >= 2 AND metric_value > first_value
)
SELECT item_id AS item, kind, source, '${metric}' AS metric, first_at AS firstAt,
  observed_at AS lastAt, first_value AS "from", metric_value AS "to", gain,
  CASE WHEN first_value = 0 THEN NULL ELSE (metric_value - first_value) * 1.0 / first_value END AS relativeGain,
  COALESCE((SELECT decision FROM catalog_events AS decisions
    WHERE decisions.item_id = candidates.item_id AND decision IS NOT NULL
    ORDER BY seq DESC LIMIT 1), 'none') AS decision
FROM candidates
WHERE chosen = 1 AND (? IS NULL OR gain < ? OR (gain = ? AND item_id > ?))
ORDER BY gain DESC, item_id LIMIT ?`;

export const repeatAuthorsSql = `
WITH authors AS (
  SELECT source, author, COUNT(DISTINCT item_id) AS items FROM catalog_events
  WHERE observed_at >= ? AND observed_at < ? AND author IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM json_each(?) AS excluded
      WHERE json_extract(excluded.value, '$.source') = catalog_events.source
        AND json_extract(excluded.value, '$.author') = catalog_events.author)
  GROUP BY source, author HAVING COUNT(DISTINCT item_id) >= ?
), identities AS (
  SELECT source, author, items, json_array(source, author) AS identity FROM authors
)
SELECT source, author, items FROM identities
WHERE (? IS NULL OR items < ? OR (items = ? AND identity > ?))
ORDER BY items DESC, identity LIMIT ?`;

const SqlRisingEntry = Schema.Struct({
  ...RisingEntry.fields,
  firstAt: Schema.DateTimeUtcFromMillis,
  lastAt: Schema.DateTimeUtcFromMillis,
});

const insertSql = `INSERT INTO catalog_events
(id, item_id, stream, seq, recorded_at, event_json, kind, source, observed_at, author, stars, views, decision)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO NOTHING`;

const makeCatalogSqlStore = (sql: CatalogSql) =>
  CatalogStore.of({
    quarantine: (row, reason) =>
      sql
        .batch([
          {
            sql: `INSERT INTO catalog_quarantine (id, stream, seq, reason) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET reason = excluded.reason`,
            parameters: [
              `${row.stream}:${row.seq}`,
              row.stream,
              row.seq,
              reason,
            ],
          },
        ])
        .pipe(
          Effect.mapError(
            (cause) => new CatalogUnavailable({ operation: "record", cause })
          )
        ),
    record: Effect.fn("CatalogSql.record")(function* record(rows) {
      const parsed = yield* validateCatalogRows(rows);

      const statements = yield* Effect.forEach(
        (row: typeof CatalogEventRow.Type) =>
          Schema.encodeEffect(Schema.fromJsonString(CatalogEventRow))(row).pipe(
            Effect.mapError(
              (cause) => new CatalogUnavailable({ operation: "record", cause })
            ),
            Effect.map((encoded): CatalogSqlStatement => {
              const sighting = Predicate.isTagged(row.event, "SightingRecorded")
                ? row.event
                : null;

              return {
                sql: insertSql,
                parameters: [
                  `${row.stream}:${row.seq}`,
                  row.item,
                  row.stream,
                  row.seq,
                  DateTime.toEpochMillis(row.recordedAt),
                  encoded,
                  sighting?.kind ?? null,
                  sighting?.source ?? null,
                  sighting === null
                    ? null
                    : DateTime.toEpochMillis(sighting.observedAt),
                  sighting?.author === undefined
                    ? null
                    : normalizeAuthor(sighting.author),
                  sighting?.metrics.stars ?? null,
                  sighting?.metrics.views ?? null,
                  editorialDecisionOf(row.event),
                ],
              };
            })
          )
      )(parsed);

      if (statements.length > 0) {
        for (let start = 0; start < statements.length; start += 25) {
          yield* sql.batch(statements.slice(start, start + 25));
        }
      }
    }),
    rising: Effect.fn("CatalogSql.rising")(function* rising(input, page) {
      yield* validateRisingInput(input);
      yield* validateCatalogPage(page, "rising");
      const scope = risingScope(input);
      const cursor = yield* readCatalogCursor("Rising", scope, page.after);
      const rank = cursor?.rank ?? null;

      const rows = yield* sql.query("rising", {
        sql: risingSql(input.metric),
        parameters: [
          DateTime.toEpochMillis(input.from),
          DateTime.toEpochMillis(input.until),
          rank,
          rank,
          rank,
          cursor?.key ?? null,
          page.take + 1,
        ],
      });

      const entries = yield* Schema.decodeUnknownEffect(
        Schema.Array(SqlRisingEntry)
      )(rows).pipe(
        Effect.mapError(
          (cause) => new CatalogUnavailable({ operation: "rising", cause })
        )
      );

      return catalogPage("Rising", scope, entries, page, (entry) => ({
        rank: entry.gain,
        key: entry.item,
      }));
    }),
    repeatAuthors: Effect.fn("CatalogSql.repeatAuthors")(
      function* repeatAuthors(input, page) {
        yield* validateRepeatAuthorsInput(input);
        yield* validateCatalogPage(page, "repeatAuthors");
        const scope = repeatAuthorsScope(input);

        const cursor = yield* readCatalogCursor(
          "RepeatAuthors",
          scope,
          page.after
        );

        const rank = cursor?.rank ?? null;

        const rows = yield* sql.query("repeatAuthors", {
          sql: repeatAuthorsSql,
          parameters: [
            DateTime.toEpochMillis(input.from),
            DateTime.toEpochMillis(input.until),
            JSON.stringify(
              input.excludedAuthors.map((identity) => ({
                source: identity.source,
                author: normalizeAuthor(identity.author),
              }))
            ),
            input.minimumItems,
            rank,
            rank,
            rank,
            cursor?.key ?? null,
            page.take + 1,
          ],
        });

        const entries = yield* Schema.decodeUnknownEffect(
          Schema.Array(RepeatAuthorEntry)
        )(rows).pipe(
          Effect.mapError(
            (cause) =>
              new CatalogUnavailable({ operation: "repeatAuthors", cause })
          )
        );

        return catalogPage("RepeatAuthors", scope, entries, page, (entry) => ({
          rank: entry.items,
          key: authorIdentityKey(entry),
        }));
      }
    ),
  });

export const catalogSqlLayer = <E, R>(build: Effect.Effect<CatalogSql, E, R>) =>
  Layer.effect(CatalogStore, build.pipe(Effect.map(makeCatalogSqlStore)));
