import * as Domain from "@alchemy.run/domain";
import { it } from "@effect/vitest";
import { Catalog, CatalogHandlers } from "@rat-stack/catalog/Catalog.model";
import { ItemId } from "@rat-stack/catalog/Item/Item.id";
import type { Sighting } from "@rat-stack/catalog/Item/Sighting";
import { OperatorApi } from "@rat-stack/catalog/OperatorApi.api";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { expect } from "vitest";

import { operatorTokenLayer } from "../src/OperatorToken.ts";

const token = Redacted.make("synthetic-test-token");

const authorized = {
  headers: { authorization: "Bearer synthetic-test-token" },
};

const world = operatorTokenLayer(Option.some(token)).pipe(
  Layer.provideMerge(Catalog.layer(CatalogHandlers)),
  Layer.provide(Domain.InMemory)
);

const id = ItemId.make("https://example.test/operator-item");

const observation = {
  kind: "repo",
  source: "synthetic",
  observedAt: DateTime.makeUnsafe("2026-01-02T12:00:00Z"),
  metrics: { stars: 10 },
} satisfies typeof Sighting.Type;

it.live(
  "authenticates commands and history reads and preserves command-id receipts",
  () =>
    Effect.gen(function* authenticateAndPageHistory() {
      const api = yield* OperatorApi.clientInProcess;

      const first = yield* api.RecordSighting(id, observation, {
        ...authorized,
        commandId: "synthetic-retry",
      });

      const retry = yield* api.RecordSighting(id, observation, {
        ...authorized,
        commandId: "synthetic-retry",
      });

      expect(retry).toEqual(first);
      yield* api.Keep(id, { why: "Synthetic example" }, authorized);

      const dropped = yield* api.Drop(
        id,
        { why: "Synthetic scope change" },
        authorized
      );

      const history = yield* api.ItemHistory.get(id, {
        ...authorized,
        atLeast: dropped,
      });

      expect(history).toMatchObject({ sightings: 1, decision: "dropped" });
      const page = yield* api.ItemHistory.list(id, { ...authorized, take: 2 });
      expect(page.entries).toHaveLength(2);

      const pageOptions =
        page.cursor === null
          ? { ...authorized, take: 2 }
          : { ...authorized, take: 2, after: page.cursor };

      const next = yield* api.ItemHistory.list(id, pageOptions);

      expect(next.entries).toHaveLength(1);
      expect(
        [...page.entries, ...next.entries].map(({ event }) => event._tag)
      ).toEqual(["SightingRecorded", "ItemKept", "ItemDropped"]);
    }).pipe(Effect.scoped, Effect.provide(world))
);

for (const authorization of [
  undefined,
  "Bearer wrong",
  "Basic synthetic-test-token",
  "Bearer ",
]) {
  it.effect(
    `denies commands and every history read with ${authorization === undefined ? "no token" : "an invalid token"}`,
    () =>
      Effect.gen(function* refuseUnauthorizedCalls() {
        const api = yield* OperatorApi.clientInProcess;
        yield* api.RecordSighting(id, observation, authorized);

        const options =
          authorization === undefined ? {} : { headers: { authorization } };

        expect(
          (yield* api
            .RecordSighting(id, observation, options)
            .pipe(Effect.flip))._tag
        ).toBe("Unauthorized");
        expect(
          (yield* api
            .Keep(id, { why: "Unauthorized change" }, options)
            .pipe(Effect.flip))._tag
        ).toBe("Unauthorized");
        expect(
          (yield* api
            .Drop(id, { why: "Unauthorized change" }, options)
            .pipe(Effect.flip))._tag
        ).toBe("Unauthorized");
        expect(
          (yield* api.ItemHistory.get(id, options).pipe(Effect.flip))._tag
        ).toBe("Unauthorized");
        expect(
          (yield* api.ItemHistory.snapshot(id, options).pipe(Effect.flip))._tag
        ).toBe("Unauthorized");
        expect(
          (yield* api.ItemHistory.list(id, options).pipe(Effect.flip))._tag
        ).toBe("Unauthorized");
        expect(
          (yield* api.ItemHistory.watch(id, options).pipe(
            Stream.runHead,
            Effect.flip
          ))._tag
        ).toBe("Unauthorized");
        expect(
          (yield* api.ItemHistory.events(id, options).pipe(
            Stream.runHead,
            Effect.flip
          ))._tag
        ).toBe("Unauthorized");
      }).pipe(Effect.scoped, Effect.provide(world))
  );
}

for (const configured of [
  Option.none<Redacted.Redacted>(),
  Option.some(Redacted.make("")),
]) {
  it.effect("denies all access while the operator token is unprovisioned", () =>
    Effect.gen(function* refuseUnprovisionedToken() {
      const api = yield* OperatorApi.clientInProcess;
      expect(
        (yield* api
          .RecordSighting(id, observation, authorized)
          .pipe(Effect.flip))._tag
      ).toBe("Unauthorized");
      expect(
        (yield* api.ItemHistory.get(id, authorized).pipe(Effect.flip))._tag
      ).toBe("Unauthorized");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        operatorTokenLayer(configured).pipe(
          Layer.provideMerge(Catalog.layer(CatalogHandlers)),
          Layer.provide(Domain.InMemory)
        )
      )
    )
  );
}
