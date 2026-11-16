import { Story } from "@alchemy.run/domain/Story";
import { it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";

import { Catalog, CatalogHandlers } from "../src/Catalog.model.ts";
import { CatalogMemory } from "../src/Catalog/CatalogMemory.ts";
import type { RisingInput } from "../src/Catalog/CatalogValues.ts";
import { InvalidWindow } from "../src/Catalog/InvalidWindow.rejection.ts";
import { RepeatAuthors } from "../src/Catalog/RepeatAuthors.query.ts";
import { Rising } from "../src/Catalog/Rising.query.ts";
import { Item } from "../src/Item/Item.aggregate.ts";
import { ItemId } from "../src/Item/Item.id.ts";
import {
  RecordSighting,
  SightingRecorded,
} from "../src/Item/RecordSighting.command.ts";
import type { Sighting } from "../src/Item/Sighting.ts";
import { Operator } from "../src/Operator.context.ts";
import { Unauthorized } from "../src/Operator.middleware.ts";

const story = Story.make(Catalog, {
  layer: CatalogHandlers.pipe(Layer.provide(CatalogMemory)),
});

const expectEvents = Story.then;

const a = Item.ref(ItemId.make("https://example.test/query-a"));

const b = Item.ref(ItemId.make("https://example.test/query-b"));

const window = {
  from: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
  until: DateTime.makeUnsafe("2026-01-05T00:00:00Z"),
};

const rising: typeof RisingInput.Type = { ...window, metric: "stars" };

const repeats = { ...window, minimumItems: 2, excludedAuthors: [] };

const observation = (date: string, stars: number): typeof Sighting.Type => ({
  kind: "repo",
  source: "synthetic",
  observedAt: DateTime.makeUnsafe(date),
  author: "synthetic-author",
  metrics: { stars },
});

const recorded = (input: typeof Sighting.Type) =>
  new SightingRecorded({
    ...input,
    sightingKey: `9:synthetic:${DateTime.formatIsoDate(input.observedAt)}`,
  });

const first = observation("2026-01-02T12:00:00Z", 0);

const later = observation("2026-01-04T12:00:00Z", 30);

const slower = observation("2026-01-04T12:00:00Z", 10);

it.effect(
  "projects committed sightings and serves the derived Queries with receipt-ordered story execution",
  () =>
    story(
      Story.provide(Operator, { authenticated: true }),
      Story.when(a, new RecordSighting(first)),
      expectEvents(a, recorded(first)),
      Story.when(a, new RecordSighting(later)),
      expectEvents(a, recorded(later)),
      Story.when(a, new RecordSighting({ ...later, metrics: { stars: 999 } })),
      expectEvents(a),
      Story.when(b, new RecordSighting(first)),
      expectEvents(b, recorded(first)),
      Story.when(b, new RecordSighting(slower)),
      expectEvents(b, recorded(slower)),
      Story.query(Rising, rising, [
        { item: a.id, gain: 30 },
        { item: b.id, gain: 10 },
      ]),
      Story.query(RepeatAuthors, repeats, [
        { source: "synthetic", author: "synthetic-author", items: 2 },
      ]),
      Story.query(
        RepeatAuthors,
        {
          ...repeats,
          excludedAuthors: [
            { source: "synthetic", author: "SYNTHETIC-AUTHOR" },
          ],
        },
        []
      ),
      Story.query(Rising, { ...rising, until: window.from }),
      Story.rejected(new InvalidWindow({ maximumDays: 30 }))
    )
);

it.effect(
  "refuses both Queries without an operator context, even when the index is empty",
  () =>
    story(
      Story.query(Rising, rising),
      Story.rejected(new Unauthorized()),
      Story.query(RepeatAuthors, repeats),
      Story.rejected(new Unauthorized())
    )
);
