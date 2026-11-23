import { it } from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { expect } from "vitest";

import { Item } from "../src/Item/Item.aggregate.ts";
import { ItemId } from "../src/Item/Item.id.ts";
import { ItemHistory } from "../src/Item/ItemHistory.view.ts";
import { RecordSighting } from "../src/Item/RecordSighting.command.ts";
import type { Sighting } from "../src/Item/Sighting.ts";
import { Operator } from "../src/Operator.context.ts";
import { makeCatalogPropertyWorld } from "./catalog-property-world.ts";

const observations = Schema.Array(
  Schema.Struct({
    source: Schema.Literals(["synthetic-a", "synthetic-b"]),
    hour: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 95 })),
    stars: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })),
  })
).check(Schema.isMinLength(1), Schema.isMaxLength(16));

it.effect.prop(
  "records exactly the first sighting per source and UTC day, including retries with new command ids",
  { observations: Arbitrary.schema(observations) },
  ({ observations: generated }) => {
    const { drain, world } = makeCatalogPropertyWorld();

    return Effect.gen(function* deduplicateGeneratedSightings() {
      const items = yield* Item;
      const histories = yield* ItemHistory;
      const id = ItemId.make("https://example.test/generated");
      const firstBySourceAndDay = new Map<string, number>();

      let lastReceipt:
        | { readonly stream: string; readonly version: number }
        | undefined;

      for (const observation of generated) {
        const day = Math.floor(observation.hour / 24);
        const key = `${observation.source}/${day}`;

        if (!firstBySourceAndDay.has(key)) {
          firstBySourceAndDay.set(key, observation.stars);
        }

        const input = {
          kind: "repo",
          source: observation.source,
          observedAt: DateTime.makeUnsafe(
            1_767_225_600_000 + observation.hour * 3_600_000
          ),
          metrics: { stars: observation.stars },
        } satisfies typeof Sighting.Type;

        yield* items.send(id, new RecordSighting(input));
        lastReceipt = yield* items.send(
          id,
          new RecordSighting({
            ...input,
            metrics: { stars: observation.stars + 1 },
          })
        );
      }

      yield* drain;

      const history = yield* histories.get(
        Item.ref(id),
        lastReceipt === undefined ? {} : { atLeast: lastReceipt }
      );

      expect(Option.getOrThrow(history).sightings).toBe(
        firstBySourceAndDay.size
      );
      const state = yield* items.get(id);
      expect(state.sightingKeys).toHaveLength(firstBySourceAndDay.size);
      const entries = yield* histories.list(Item.ref(id), { take: 100 });

      const starsBySourceAndDay = new Map(
        entries.entries.flatMap(({ event }) =>
          Predicate.isTagged(event, "SightingRecorded")
            ? [
                [
                  `${event.source}/${Math.floor((DateTime.toEpochMillis(event.observedAt) - 1_767_225_600_000) / 86_400_000)}`,
                  event.metrics.stars,
                ],
              ]
            : []
        )
      );

      expect(starsBySourceAndDay).toEqual(firstBySourceAndDay);
    }).pipe(
      Effect.provideService(Operator, { authenticated: true }),
      Effect.provide(world),
      TestClock.withLive
    );
  },
  { arbitrary: { runs: 100 } }
);
