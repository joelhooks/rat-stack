import { expect, it } from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { Item } from "../src/Item/Item.aggregate.ts";
import { ItemId } from "../src/Item/Item.id.ts";
import { ItemHistory } from "../src/Item/ItemHistory.view.ts";
import { RecordSighting } from "../src/Item/RecordSighting.command.ts";
import { Operator } from "../src/Operator.context.ts";
import { makeCatalogPropertyWorld } from "./catalog-property-world.ts";

it.effect.prop(
  "RecordSighting commits the canonical lowercase author rather than merely folding the derived index",
  {
    author: Arbitrary.schema(Schema.NonEmptyString),
  },
  ({ author }) => {
    const { drain, world } = makeCatalogPropertyWorld();

    return Effect.gen(function* commitCanonicalAuthor() {
      const items = yield* Item;
      const histories = yield* ItemHistory;
      const id = ItemId.make("https://example.test/canonical-author");

      const receipt = yield* items.send(
        id,
        new RecordSighting({
          kind: "repo",
          source: "synthetic",
          author,
          observedAt: DateTime.makeUnsafe(0),
          metrics: {},
        })
      );

      yield* drain;
      const history = yield* histories.get(Item.ref(id), { atLeast: receipt });
      expect(Option.getOrThrow(history).latestSighting?.author).toBe(
        author.toLowerCase()
      );
    }).pipe(
      Effect.provideService(Operator, { authenticated: true }),
      Effect.provide(world),
      TestClock.withLive
    );
  },
  { arbitrary: { runs: 100 } }
);
