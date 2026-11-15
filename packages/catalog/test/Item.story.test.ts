import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import { it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import { expect } from "vitest";

import { Catalog, CatalogHandlers } from "../src/Catalog.model.ts";
import { CatalogMemory } from "../src/Catalog/CatalogMemory.ts";
import { Drop, ItemDropped } from "../src/Item/Drop.command.ts";
import { Item } from "../src/Item/Item.aggregate.ts";
import { ItemId } from "../src/Item/Item.id.ts";
import { ItemHistory } from "../src/Item/ItemHistory.view.ts";
import { ItemKept, Keep } from "../src/Item/Keep.command.ts";
import {
  KindMismatch,
  RecordSighting,
  SightingRecorded,
} from "../src/Item/RecordSighting.command.ts";
import type { Sighting } from "../src/Item/Sighting.ts";
import { UnseenItem } from "../src/Item/UnseenItem.rejection.ts";
import { Operator } from "../src/Operator.context.ts";

const expectEvents = Story.then;

const story = Story.make(Catalog, {
  layer: CatalogHandlers.pipe(Layer.provide(CatalogMemory)),
});

const item = Item.ref(ItemId.make("https://example.test/project"));

const observation = {
  kind: "repo",
  source: "synthetic",
  observedAt: DateTime.makeUnsafe("2026-01-02T12:00:00Z"),
  metrics: { stars: 12 },
  author: "synthetic-author",
} satisfies typeof Sighting.Type;

const recorded = new SightingRecorded({
  ...observation,
  sightingKey: "9:synthetic:2026-01-02",
});

it("has a complete model declaration", () => {
  expect(Domain.verify(Catalog)).toEqual([]);
});

it.effect(
  "records observations and exposes their history without changing decisions",
  () =>
    story(
      Story.provide(Operator, { authenticated: true }),
      Story.when(item, new RecordSighting(observation)),
      expectEvents(item, recorded),
      Story.view(ItemHistory, item, {
        sightings: 1,
        latestSighting: observation,
        decision: "undecided",
      }),
      Story.emitted(ItemHistory, item, [recorded]),
      Story.when(
        item,
        new RecordSighting({ ...observation, metrics: { stars: 99 } })
      ),
      expectEvents(item),
      Story.view(ItemHistory, item, {
        sightings: 1,
        latestSighting: observation,
      }),
      Story.when(item, new RecordSighting({ ...observation, source: "other" })),
      expectEvents(
        item,
        new SightingRecorded({
          ...observation,
          source: "other",
          sightingKey: "5:other:2026-01-02",
        })
      ),
      Story.when(
        item,
        new RecordSighting({
          ...observation,
          observedAt: DateTime.makeUnsafe("2026-01-03T00:00:00Z"),
        })
      ),
      expectEvents(
        item,
        new SightingRecorded({
          ...observation,
          observedAt: DateTime.makeUnsafe("2026-01-03T00:00:00Z"),
          sightingKey: "9:synthetic:2026-01-03",
        })
      ),
      Story.view(ItemHistory, item, { sightings: 3 })
    )
);

it.effect(
  "keeps, drops and reconsiders while repeated decisions emit nothing",
  () =>
    story(
      Story.given(item, recorded),
      Story.provide(Operator, { authenticated: true }),
      Story.when(item, new Keep({ why: "Relevant example" })),
      expectEvents(item, new ItemKept({ why: "Relevant example" })),
      Story.when(item, new Keep({ why: "Still relevant" })),
      expectEvents(item),
      Story.when(item, new Drop({ why: "Outside the current scope" })),
      expectEvents(item, new ItemDropped({ why: "Outside the current scope" })),
      Story.when(item, new Drop({ why: "Still outside" })),
      expectEvents(item),
      Story.when(item, new Keep({ why: "Reconsidered" })),
      expectEvents(item, new ItemKept({ why: "Reconsidered" })),
      Story.view(ItemHistory, item, {
        sightings: 1,
        decision: "kept",
        why: "Reconsidered",
      })
    )
);

it.effect("refuses both decisions for an unseen item", () =>
  story(
    Story.provide(Operator, { authenticated: true }),
    Story.when(item, new Keep({ why: "Not yet seen" })),
    Story.rejected(new UnseenItem()),
    Story.when(item, new Drop({ why: "Not yet seen" })),
    Story.rejected(new UnseenItem()),
    expectEvents(item)
  )
);

it.effect("refuses a kind change even when the source and day repeat", () =>
  story(
    Story.given(item, recorded),
    Story.provide(Operator, { authenticated: true }),
    Story.when(item, new RecordSighting({ ...observation, kind: "video" })),
    Story.rejected(new KindMismatch({ recorded: "repo", requested: "video" })),
    expectEvents(item)
  )
);
