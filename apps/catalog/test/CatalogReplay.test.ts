import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { CatalogMemory } from "@rat-stack/catalog/Catalog/CatalogMemory";
import { CatalogStore } from "@rat-stack/catalog/Catalog/CatalogStore";
import { ItemId } from "@rat-stack/catalog/Item/Item.id";
import { SightingRecorded } from "@rat-stack/catalog/Item/RecordSighting.command";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { SqliteCatalog, sqliteCatalogFixture } from "./SqliteCatalog.ts";

const item = ItemId.make("https://example.test/divergent-replay");

const row = (seq: number, stars: number) => ({
  item,
  stream: `Item/${item}`,
  seq,
  recordedAt: DateTime.makeUnsafe(0),
  event: new SightingRecorded({
    kind: "repo",
    source: "synthetic",
    observedAt: DateTime.makeUnsafe(seq * 86_400_000),
    metrics: { stars },
    sightingKey: `synthetic:${seq}`,
  }),
});

for (const { name, layer } of [
  { name: "memory", layer: CatalogMemory },
  { name: "SQLite", layer: SqliteCatalog },
]) {
  it.effect(
    `${name}: identical replay is harmless and divergent replay fails without changing the committed index`,
    () =>
      Effect.gen(function* rejectDivergentReplay() {
        const store = yield* CatalogStore;
        const original = [row(1, 0), row(2, 30)];
        yield* store.record(original);
        yield* store.record(original.toReversed());
        const failure = yield* store.record([row(2, 999)]).pipe(Effect.flip);
        expect(failure._tag).toBe("CatalogUnavailable");
        expect(Cause.pretty(Cause.fail(failure))).toContain(
          "Divergent catalog replay"
        );

        const result = yield* store.rising(
          {
            from: DateTime.makeUnsafe(0),
            until: DateTime.makeUnsafe(3 * 86_400_000),
            metric: "stars",
          },
          { take: 1, after: undefined }
        );

        expect(result.entries.at(0)?.gain).toBe(30);
      }).pipe(Effect.provide(layer))
  );
}

it.effect(
  "SQLite quarantine keeps a durable source position and reason without manufacturing an observation",
  () =>
    Effect.gen(function* persistQuarantine() {
      const { store, database } = yield* sqliteCatalogFixture;
      yield* store.quarantine(row(1, 0), "Synthetic permanent refusal");
      yield* store.quarantine(
        row(1, 0),
        "Synthetic permanent refusal confirmed"
      );

      const persisted = yield* Schema.decodeUnknownEffect(
        Schema.Array(
          Schema.Struct({
            stream: Schema.String,
            seq: Schema.Natural,
            reason: Schema.String,
          })
        )
      )(
        database
          .prepare("SELECT stream, seq, reason FROM catalog_quarantine")
          .all()
      );

      expect(persisted).toEqual([
        {
          stream: `Item/${item}`,
          seq: 1,
          reason: "Synthetic permanent refusal confirmed",
        },
      ]);
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM catalog_events").get()
          ?.count
      ).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
