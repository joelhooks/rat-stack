import { expect, it } from "@effect/vitest";
import { CatalogStore } from "@rat-stack/catalog/Catalog/CatalogStore";
import { ItemId } from "@rat-stack/catalog/Item/Item.id";
import { SightingRecorded } from "@rat-stack/catalog/Item/RecordSighting.command";
import * as Arbitrary from "effect/Arbitrary";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import { catalogSqlLayer } from "../src/Catalog/CatalogSql.ts";
import type {
  CatalogSql,
  CatalogSqlStatement,
} from "../src/Catalog/CatalogSql.ts";
import { catalogWriteFailure } from "../src/Catalog/CatalogWriteFailure.ts";

it.effect.prop(
  "bounded SQL batches deliver every accepted position exactly once across chunk boundaries",
  {
    count: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
    ),
  },
  ({ count }) =>
    Effect.gen(function* boundWriteRequests() {
      const sent = yield* Ref.make<readonly (readonly CatalogSqlStatement[])[]>(
        []
      );

      const driver: CatalogSql = {
        query: () => Effect.succeed([]),
        batch: (statements) => Ref.update(sent, (all) => [...all, statements]),
      };

      const item = ItemId.make("https://example.test/batch-bounds");

      const rows = Array.from({ length: count }, (_, index) => ({
        item,
        stream: `Item/${item}`,
        seq: index + 1,
        recordedAt: DateTime.makeUnsafe(0),
        event: new SightingRecorded({
          kind: "repo",
          source: "synthetic",
          observedAt: DateTime.makeUnsafe(index * 86_400_000),
          metrics: { stars: index },
          sightingKey: `synthetic:${index}`,
        }),
      }));

      yield* Effect.gen(function* writeAllRows() {
        const store = yield* CatalogStore;
        yield* store.record(rows);
      }).pipe(Effect.provide(catalogSqlLayer(Effect.succeed(driver))));
      const batches = yield* Ref.get(sent);
      expect(
        batches.every((batch) => batch.length > 0 && batch.length <= 25)
      ).toBe(true);
      expect(
        batches.flatMap((batch) =>
          batch.map((statement) => statement.parameters[0])
        )
      ).toEqual(rows.map((row) => `${row.stream}:${row.seq}`));
    })
);

it.effect.prop(
  "only a row-size refusal is quarantinable; invocation limits, capacity and divergent replay remain loud retryable failures",
  {
    message: Arbitrary.schema(
      Schema.Literals([
        "Too many API requests by single Worker invocation",
        "D1_ERROR: database or disk is full: SQLITE_FULL",
        "database too large",
        "Divergent catalog replay at the same stream:seq",
      ])
    ),
  },
  ({ message }) =>
    Effect.sync(() => {
      expect(catalogWriteFailure(Cause.fail(new Error(message)))._tag).toBe(
        "CatalogUnavailable"
      );
      expect(
        catalogWriteFailure(
          Cause.fail(
            new Error("D1_ERROR: string or blob too big: SQLITE_TOOBIG")
          )
        )._tag
      ).toBe("InvalidCatalogInput");
    })
);
