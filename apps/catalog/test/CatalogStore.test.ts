import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { CatalogMemory } from "@rat-stack/catalog/Catalog/CatalogMemory";
import { CatalogStore } from "@rat-stack/catalog/Catalog/CatalogStore";
import type {
  CatalogEventRow,
  RisingEntry,
  RisingInput,
} from "@rat-stack/catalog/Catalog/CatalogValues";
import { ItemDropped } from "@rat-stack/catalog/Item/Drop.command";
import { ItemId } from "@rat-stack/catalog/Item/Item.id";
import { ItemKept } from "@rat-stack/catalog/Item/Keep.command";
import { SightingRecorded } from "@rat-stack/catalog/Item/RecordSighting.command";
import * as Arbitrary from "effect/Arbitrary";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { expect } from "vitest";

import { repeatAuthorsSql, risingSql } from "../src/Catalog/CatalogSql.ts";
import { SqliteCatalog, sqliteCatalogFixture } from "./SqliteCatalog.ts";

const epoch = 1_767_225_600_000;

const day = 86_400_000;

const from = DateTime.makeUnsafe(epoch);

const until = DateTime.makeUnsafe(epoch + 4 * day);

const window = { from, until };

const authorOrder = [
  "synthetic-author",
  "\uE000synthetic",
  "𐀀synthetic",
  "🧪synthetic",
];

const cases = Schema.Array(
  Schema.Struct({
    base: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
    deltaA: Schema.Int.check(Schema.isBetween({ minimum: -500, maximum: 500 })),
    deltaB: Schema.Int.check(Schema.isBetween({ minimum: -500, maximum: 500 })),
    author: Schema.Literals([
      "Synthetic-author",
      "synthetic-author",
      "\uE000synthetic",
      "𐀀synthetic",
      "🧪synthetic",
    ]),
    anonymous: Schema.Boolean,
    decision: Schema.Literals(["none", "kept", "dropped"]),
  })
).check(Schema.isMinLength(2), Schema.isMaxLength(8));

interface SightingRow extends Omit<typeof CatalogEventRow.Type, "event"> {
  readonly event: SightingRecorded;
}

const observation = (
  item: number,
  seq: number,
  date: number,
  source: string,
  stars?: number,
  author?: string
): SightingRow => {
  const url = ItemId.make(`https://example.test/store-item/${item}`);

  return {
    item: url,
    stream: `Item/${url}`,
    seq,
    recordedAt: DateTime.makeUnsafe(epoch + 10 * day),
    event: new SightingRecorded({
      kind: "repo",
      source,
      observedAt: DateTime.makeUnsafe(epoch + date * day),
      metrics: stars === undefined ? { views: 999_999 } : { stars },
      author,
      sightingKey: `${source}:${date}`,
    }),
  };
};

const decisionRow = (
  item: number,
  seq: number,
  decision: "kept" | "dropped"
): typeof CatalogEventRow.Type => ({
  ...observation(item, seq, 10, "synthetic"),
  event:
    decision === "kept"
      ? new ItemKept({ why: "Synthetic decision" })
      : new ItemDropped({ why: "Synthetic decision" }),
});

const allRising = Effect.fn("allRising")(function* allRising(
  store: CatalogStore["Service"],
  input: typeof RisingInput.Type
) {
  const entries: (typeof RisingEntry.Type)[] = [];
  let after: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const filters =
      page === 0
        ? input
        : { metric: input.metric, until: input.until, from: input.from };

    const next = yield* store.rising(filters, { take: 1, after });
    entries.push(...next.entries);

    if (next.cursor === null) {
      return entries;
    }

    expect(next.cursor).not.toBe(after);
    after = next.cursor;
  }

  return yield* Effect.die("Synthetic Rising pagination did not terminate");
});

for (const { name, layer } of [
  { name: "memory", layer: CatalogMemory },
  { name: "D1 SQL on SQLite", layer: SqliteCatalog },
]) {
  it.effect.prop(
    `${name}: replay and reordering preserve measured same-source gains, missing metrics and distinct-author counts`,
    { generated: Arbitrary.schema(cases) },
    ({ generated }) =>
      Effect.gen(function* replayGeneratedHistory() {
        const store = yield* CatalogStore;

        const rows = generated.flatMap((item, index) => {
          const author = item.anonymous ? undefined : item.author;

          const decisions =
            item.decision === "none"
              ? []
              : [
                  decisionRow(
                    index,
                    8,
                    item.decision === "kept" ? "dropped" : "kept"
                  ),
                  decisionRow(index, 9, item.decision),
                ];

          return [
            ...decisions,
            observation(index, 1, 0, "synthetic-a", undefined, author),
            observation(index, 2, 1, "synthetic-a", 1000 + item.base, author),
            observation(
              index,
              3,
              3,
              "synthetic-a",
              1000 + item.base + item.deltaA,
              author
            ),
            observation(
              index,
              4,
              1,
              "synthetic-b",
              100_000 + item.base,
              author
            ),
            observation(
              index,
              5,
              3,
              "synthetic-b",
              100_000 + item.base + item.deltaB,
              author
            ),
            observation(index, 6, 5, "synthetic-b", 999_999, author),
            observation(index, 7, -1, "synthetic-a", 0, author),
            observation(index + 100, 1, 5, "synthetic-a", 2000, author),
            observation(index + 200, 1, -1, "synthetic-a", 2000, author),
          ];
        });

        yield* store.record(rows.toReversed());
        yield* store.record(rows);
        const actual = yield* allRising(store, { ...window, metric: "stars" });

        const expected = generated
          .flatMap((item, index) => {
            const gain = Math.max(item.deltaA, item.deltaB);

            return gain > 0
              ? [
                  {
                    item: ItemId.make(
                      `https://example.test/store-item/${index}`
                    ),
                    gain,
                    source:
                      item.deltaA >= item.deltaB
                        ? "synthetic-a"
                        : "synthetic-b",
                  },
                ]
              : [];
          })
          .toSorted(
            (left, right) =>
              right.gain - left.gain || left.item.localeCompare(right.item)
          );

        expect(
          actual.map(({ item, gain, source }) => ({ item, gain, source }))
        ).toEqual(expected);
        expect(new Set(actual.map((entry) => entry.item)).size).toBe(
          actual.length
        );

        const planned = new Map(
          generated.map((item, index) => [
            ItemId.make(`https://example.test/store-item/${index}`),
            item,
          ])
        );

        for (const entry of actual) {
          const item = planned.get(entry.item);

          if (item === undefined) {
            return yield* Effect.die("Synthetic result has no input case");
          }

          expect(entry.gain).toBe(entry.to - entry.from);
          expect(entry.from).toBe(
            (entry.source === "synthetic-a" ? 1000 : 100_000) + item.base
          );
          expect(entry.relativeGain).toBeCloseTo(entry.gain / entry.from);
          expect(entry.decision).toBe(item.decision);
          expect(entry.firstAt).toEqual(DateTime.makeUnsafe(epoch + day));
          expect(entry.lastAt).toEqual(DateTime.makeUnsafe(epoch + 3 * day));
        }

        const counts = new Map<string, number>();

        for (const item of generated) {
          if (item.anonymous) {
            continue;
          }

          for (const source of ["synthetic-a", "synthetic-b"]) {
            const author = item.author.toLowerCase();

            if (source === "synthetic-a" && author === "synthetic-author") {
              continue;
            }

            const key = `${source}:${author}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }

        const expectedAuthors = [...counts]
          .map(([key, items]) => {
            const [source = "", author = ""] = key.split(":");

            return { source, author, items };
          })
          .toSorted(
            (left, right) =>
              right.items - left.items ||
              left.source.localeCompare(right.source) ||
              authorOrder.indexOf(left.author) -
                authorOrder.indexOf(right.author)
          );

        const authors = [];
        let after: string | undefined;

        for (let page = 0; page < 20; page += 1) {
          const result = yield* store.repeatAuthors(
            {
              ...window,
              minimumItems: 1,
              excludedAuthors:
                page % 2 === 0
                  ? [
                      { source: "synthetic-a", author: "Synthetic-author" },
                      { source: "synthetic-a", author: "synthetic-absent" },
                    ]
                  : [
                      { source: "synthetic-a", author: "synthetic-absent" },
                      { source: "synthetic-a", author: "SYNTHETIC-AUTHOR" },
                    ],
            },
            { take: 1, after }
          );

          authors.push(...result.entries);

          if (result.cursor === null) {
            break;
          }

          after = result.cursor;
        }

        expect(authors).toEqual(expectedAuthors);

        return yield* Effect.void;
      }).pipe(Effect.provide(layer)),
    { arbitrary: { runs: 100 } }
  );

  it.effect(
    `${name}: rejects invalid windows, filters, row batches and cross-query cursors before reading`,
    () =>
      Effect.gen(function* refuseInvalidInputs() {
        const store = yield* CatalogStore;
        const input: typeof RisingInput.Type = { ...window, metric: "stars" };
        yield* store.record([
          observation(0, 1, 1, "synthetic", 0),
          observation(0, 2, 3, "synthetic", 10),
          observation(1, 1, 1, "synthetic", 0),
          observation(1, 2, 3, "synthetic", 20),
        ]);
        expect(
          (yield* store
            .rising({ ...input, until: from }, { take: 1, after: undefined })
            .pipe(Effect.flip))._tag
        ).toBe("InvalidWindow");
        expect(
          (yield* store
            .rising(
              { ...input, until: DateTime.makeUnsafe(epoch + 31 * day) },
              { take: 1, after: undefined }
            )
            .pipe(Effect.flip))._tag
        ).toBe("InvalidWindow");
        expect(
          (yield* store
            .rising(input, { take: 201, after: undefined })
            .pipe(Effect.flip))._tag
        ).toBe("InvalidCatalogInput");
        expect(
          (yield* store
            .repeatAuthors(
              {
                ...window,
                minimumItems: 1,
                excludedAuthors: Array.from({ length: 501 }, () => ({
                  source: "synthetic",
                  author: "synthetic",
                })),
              },
              { take: 1, after: undefined }
            )
            .pipe(Effect.flip))._tag
        ).toBe("InvalidCatalogInput");
        expect(
          (yield* store
            .rising(input, { take: 1, after: "not-json" })
            .pipe(Effect.flip))._tag
        ).toBe("InvalidCatalogCursor");
        const first = yield* store.rising(input, { take: 1, after: undefined });
        expect(first.cursor).not.toBeNull();
        expect(
          first.entries.map(({ from: baseline, relativeGain, decision }) => ({
            baseline,
            relativeGain,
            decision,
          }))
        ).toEqual([{ baseline: 0, relativeGain: null, decision: "none" }]);
        expect(
          (yield* store
            .repeatAuthors(
              { ...window, minimumItems: 1, excludedAuthors: [] },
              { take: 1, after: first.cursor ?? undefined }
            )
            .pipe(Effect.flip))._tag
        ).toBe("InvalidCatalogCursor");
        expect(
          (yield* store
            .record([
              observation(2, 1, 1, "synthetic", 0, "synthetic-new"),
              { ...observation(2, 2, 3, "synthetic", 30), seq: 0.5 },
            ])
            .pipe(Effect.flip))._tag
        ).toBe("InvalidCatalogInput");

        const authors = yield* store.repeatAuthors(
          { ...window, minimumItems: 1, excludedAuthors: [] },
          { take: 10, after: undefined }
        );

        expect(authors.entries).toEqual([]);
      }).pipe(Effect.provide(layer))
  );

  it.effect(
    `${name}: keeps views separate, allows zero baselines and accepts the 500-handle exclusion boundary`,
    () =>
      Effect.gen(function* compareViewMeasurements() {
        const store = yield* CatalogStore;

        const rows = [
          observation(20, 1, 0, "synthetic-metric", 9999, "synthetic-metric"),
        ];

        for (const { seq, date, views } of [
          { seq: 2, date: 1, views: 0 },
          { seq: 3, date: 3, views: 30 },
        ]) {
          const row = observation(
            20,
            seq,
            date,
            "synthetic-metric",
            undefined,
            "synthetic-metric"
          );

          rows.push({
            ...row,
            event: new SightingRecorded({
              kind: row.event.kind,
              source: row.event.source,
              observedAt: row.event.observedAt,
              author: row.event.author,
              sightingKey: row.event.sightingKey,
              metrics: { views },
            }),
          });
        }

        yield* store.record(rows);

        const views = yield* store.rising(
          { ...window, metric: "views" },
          { take: 10, after: undefined }
        );

        expect(views.entries).toMatchObject([
          { from: 0, to: 30, gain: 30, relativeGain: null, decision: "none" },
        ]);

        const stars = yield* store.rising(
          { ...window, metric: "stars" },
          { take: 10, after: undefined }
        );

        expect(stars.entries).toEqual([]);

        const excludedAuthors = Array.from({ length: 500 }, (_, index) => ({
          source: "synthetic-metric",
          author:
            index === 0 ? "synthetic-metric" : `synthetic-excluded-${index}`,
        }));

        const authors = yield* store.repeatAuthors(
          { ...window, minimumItems: 1, excludedAuthors },
          { take: 10, after: undefined }
        );

        expect(authors.entries).toEqual([]);
      }).pipe(Effect.provide(layer))
  );
}

it.effect(
  "D1 SQL: keeps indexed window access, atomically rolls back failed batches and rejects corrupt persisted rows",
  () =>
    Effect.gen(function* verifySqliteSeams() {
      const { database, store } = yield* sqliteCatalogFixture;

      const plans = [
        {
          sql: risingSql("stars"),
          parameters: [epoch, epoch + 4 * day, null, null, null, null, 201],
        },
        {
          sql: repeatAuthorsSql,
          parameters: [
            epoch,
            epoch + 4 * day,
            "[]",
            1,
            null,
            null,
            null,
            null,
            201,
          ],
        },
      ];

      for (const plan of plans) {
        const result = yield* Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ detail: Schema.String }))
        )(
          database
            .prepare(`EXPLAIN QUERY PLAN ${plan.sql}`)
            .all(...plan.parameters)
        );

        expect(
          result.some(
            ({ detail }) =>
              detail.includes("SEARCH catalog_events USING") &&
              detail.includes("observed_at>?") &&
              detail.includes("observed_at<?")
          )
        ).toBe(true);

        if (plan.sql === risingSql("stars")) {
          expect(
            result.some(
              ({ detail }) =>
                detail.includes("catalog_decisions") &&
                detail.includes("item_id=?")
            )
          ).toBe(true);
        }
      }

      yield* Effect.sync(() => {
        database.exec(
          "CREATE TRIGGER synthetic_failure BEFORE INSERT ON catalog_events WHEN NEW.seq = 2 BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END"
        );
      });
      expect(
        (yield* store
          .record([
            observation(0, 1, 1, "synthetic", 0, "synthetic-rollback"),
            observation(0, 2, 3, "synthetic", 10, "synthetic-rollback"),
          ])
          .pipe(Effect.flip))._tag
      ).toBe("CatalogUnavailable");

      const empty = yield* store.repeatAuthors(
        { ...window, minimumItems: 1, excludedAuthors: [] },
        { take: 10, after: undefined }
      );

      expect(empty.entries).toEqual([]);
      yield* Effect.sync(() => {
        database.exec("DROP TRIGGER synthetic_failure");
      });
      yield* store.record([
        observation(0, 1, 1, "synthetic", 0),
        observation(0, 2, 3, "synthetic", 10),
      ]);
      yield* store.record([
        observation(0, 1, 1, "synthetic", 0),
        observation(0, 2, 3, "synthetic", 10),
      ]);

      const count = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ rows: Schema.Natural })
      )(database.prepare("SELECT COUNT(*) AS rows FROM catalog_events").get());

      expect(count.rows).toBe(2);

      yield* Effect.sync(() => {
        database.exec("UPDATE catalog_events SET kind = 'invalid'");
      });
      expect(
        (yield* store
          .rising(
            { ...window, metric: "stars" },
            { take: 10, after: undefined }
          )
          .pipe(Effect.flip))._tag
      ).toBe("CatalogUnavailable");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
