import { NodeServices } from "@effect/platform-node";
import { it, expect } from "@effect/vitest";
import { CatalogEventRow } from "@rat-stack/catalog/Catalog/CatalogValues";
import { ItemId } from "@rat-stack/catalog/Item/Item.id";
import { SightingRecorded } from "@rat-stack/catalog/Item/RecordSighting.command";
import { Sighting } from "@rat-stack/catalog/Item/Sighting";
import * as Arbitrary from "effect/Arbitrary";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { sqliteCatalogFixture } from "./SqliteCatalog.ts";

it.effect.prop(
  "every generated accepted Sighting persists under the real SQLite migration without narrowing its metrics",
  {
    sighting: Arbitrary.schema(Sighting),
  },
  ({ sighting }) =>
    Effect.gen(function* persistAcceptedSighting() {
      const { store, database } = yield* sqliteCatalogFixture;
      const item = ItemId.make("https://example.test/schema-compatibility");

      const row = {
        item,
        stream: `Item/${item}`,
        seq: 1,
        recordedAt: DateTime.makeUnsafe(0),
        event: new SightingRecorded({
          ...sighting,
          sightingKey: "schema-compatibility",
        }),
      };

      yield* store.record([row]);

      const persisted = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ event_json: Schema.String })
      )(database.prepare("SELECT event_json FROM catalog_events").get());

      const decoded = yield* Schema.decodeEffect(
        Schema.fromJsonString(CatalogEventRow)
      )(persisted.event_json);

      expect(decoded).toEqual(row);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 100 } }
);
