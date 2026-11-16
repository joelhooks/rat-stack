import * as InMemory from "@alchemy.run/domain/InMemory";
import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { Catalog, CatalogHandlers } from "../src/Catalog.model.ts";
import { CatalogIndex } from "../src/Catalog/CatalogIndex.projection.ts";
import { CatalogMemory } from "../src/Catalog/CatalogMemory.ts";
import { CatalogStore } from "../src/Catalog/CatalogStore.ts";
import { CatalogUnavailable } from "../src/Catalog/CatalogUnavailable.rejection.ts";
import { InvalidCatalogInput } from "../src/Catalog/InvalidCatalogInput.rejection.ts";
import { Item } from "../src/Item/Item.aggregate.ts";
import { ItemId } from "../src/Item/Item.id.ts";
import { RecordSighting } from "../src/Item/RecordSighting.command.ts";
import type { Sighting } from "../src/Item/Sighting.ts";
import { Operator } from "../src/Operator.context.ts";

const input = (day: number): typeof Sighting.Type => ({
  kind: "repo",
  source: "synthetic",
  observedAt: DateTime.makeUnsafe(day * 86_400_000),
  metrics: { stars: day * 10 },
});

it.live(
  "Domain holds a failed projection checkpoint and redrives the pending log before a later delivery can advance it",
  () =>
    Effect.gen(function* recoverProjectionLog() {
      const platform = InMemory.make({ manual: true });
      const attempts = yield* Ref.make(0);

      const faulty = Layer.effect(
        CatalogStore,
        Effect.gen(function* failStoreOnce() {
          const actual = yield* CatalogStore;

          return CatalogStore.of({
            quarantine: actual.quarantine,
            rising: actual.rising,
            repeatAuthors: actual.repeatAuthors,
            record: (rows) =>
              Ref.getAndUpdate(attempts, (count) => count + 1).pipe(
                Effect.flatMap((count) =>
                  count === 0
                    ? Effect.fail(
                        new CatalogUnavailable({
                          operation: "record",
                          cause: new Error(
                            "Synthetic transient storage outage"
                          ),
                        })
                      )
                    : actual.record(rows)
                )
              ),
          });
        })
      ).pipe(Layer.provide(CatalogMemory));

      const world = Catalog.layer(CatalogHandlers).pipe(
        Layer.provide(Layer.mergeAll(platform.layer, faulty))
      );

      yield* Effect.gen(function* exerciseRecovery() {
        const items = yield* Item;
        const id = ItemId.make("https://example.test/projection-recovery");
        const first = yield* items.send(id, new RecordSighting(input(0)));
        yield* platform.control.drain;
        expect(platform.control.failures).toHaveLength(1);

        const before = yield* CatalogIndex.caughtUp(first).pipe(
          Effect.timeoutOrElse({
            duration: "10 millis",
            orElse: () => Effect.succeed("checkpoint-held"),
          })
        );

        expect(before).toBe("checkpoint-held");
        const second = yield* items.send(id, new RecordSighting(input(1)));
        yield* platform.control.drain;
        yield* CatalogIndex.caughtUp(second);
        expect(yield* Ref.get(attempts)).toBe(3);
      }).pipe(
        Effect.provide(world),
        Effect.provideService(Operator, { authenticated: true })
      );
    }).pipe(Effect.scoped)
);

it.live(
  "Domain quarantines a permanent input refusal with its reason before advancing the projection checkpoint",
  () =>
    Effect.gen(function* quarantinePermanentFailure() {
      const platform = InMemory.make({ manual: true });
      const reasons = yield* Ref.make<readonly string[]>([]);

      const faulty = Layer.effect(
        CatalogStore,
        Effect.gen(function* permanentlyRefuseRecord() {
          const actual = yield* CatalogStore;

          return CatalogStore.of({
            quarantine: (row, reason) =>
              actual
                .quarantine(row, reason)
                .pipe(
                  Effect.tap(() =>
                    Ref.update(reasons, (all) => [...all, reason])
                  )
                ),
            rising: actual.rising,
            repeatAuthors: actual.repeatAuthors,
            record: () =>
              Effect.fail(
                new InvalidCatalogInput({
                  operation: "record",
                  cause: new Error("Synthetic permanent row refusal"),
                })
              ),
          });
        })
      ).pipe(Layer.provide(CatalogMemory));

      const world = Catalog.layer(CatalogHandlers).pipe(
        Layer.provide(Layer.mergeAll(platform.layer, faulty))
      );

      yield* Effect.gen(function* awaitQuarantineCheckpoint() {
        const items = yield* Item;

        const receipt = yield* items.send(
          ItemId.make("https://example.test/projection-quarantine"),
          new RecordSighting(input(0))
        );

        yield* platform.control.drain;
        yield* CatalogIndex.caughtUp(receipt);
        expect(platform.control.failures).toEqual([]);
        expect(yield* Ref.get(reasons)).toEqual([
          "Error: Synthetic permanent row refusal",
        ]);
      }).pipe(
        Effect.provide(world),
        Effect.provideService(Operator, { authenticated: true })
      );
    }).pipe(Effect.scoped)
);

it.live(
  "a quarantine outage keeps the checkpoint held until Domain durably records the refused position",
  () =>
    Effect.gen(function* recoverQuarantinePersistence() {
      const platform = InMemory.make({ manual: true });
      const attempts = yield* Ref.make(0);

      const faulty = Layer.effect(
        CatalogStore,
        Effect.gen(function* refuseUntilQuarantineRecovers() {
          const actual = yield* CatalogStore;

          return CatalogStore.of({
            rising: actual.rising,
            repeatAuthors: actual.repeatAuthors,
            record: () =>
              Effect.fail(
                new InvalidCatalogInput({
                  operation: "record",
                  cause: new Error("Synthetic permanent row refusal"),
                })
              ),
            quarantine: (row, reason) =>
              Ref.getAndUpdate(attempts, (count) => count + 1).pipe(
                Effect.flatMap((count) =>
                  count === 0
                    ? Effect.fail(
                        new CatalogUnavailable({
                          operation: "record",
                          cause: new Error("Synthetic quarantine outage"),
                        })
                      )
                    : actual.quarantine(row, reason)
                )
              ),
          });
        })
      ).pipe(Layer.provide(CatalogMemory));

      const world = Catalog.layer(CatalogHandlers).pipe(
        Layer.provide(Layer.mergeAll(platform.layer, faulty))
      );

      yield* Effect.gen(function* awaitDurableQuarantine() {
        const items = yield* Item;
        const id = ItemId.make("https://example.test/quarantine-recovery");
        const first = yield* items.send(id, new RecordSighting(input(0)));
        yield* platform.control.drain;
        expect(platform.control.failures).toHaveLength(1);

        const checkpoint = yield* CatalogIndex.caughtUp(first).pipe(
          Effect.timeoutOrElse({
            duration: "10 millis",
            orElse: () => Effect.succeed("checkpoint-held"),
          })
        );

        expect(checkpoint).toBe("checkpoint-held");
        const second = yield* items.send(id, new RecordSighting(input(1)));
        yield* platform.control.drain;
        yield* CatalogIndex.caughtUp(second);
        expect(yield* Ref.get(attempts)).toBe(3);
      }).pipe(
        Effect.provide(world),
        Effect.provideService(Operator, { authenticated: true })
      );
    }).pipe(Effect.scoped)
);
