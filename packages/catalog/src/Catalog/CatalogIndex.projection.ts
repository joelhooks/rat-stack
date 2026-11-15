import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";

import { ItemDropped } from "../Item/Drop.command.ts";
import { Item } from "../Item/Item.aggregate.ts";
import { ItemKept } from "../Item/Keep.command.ts";
import { SightingRecorded } from "../Item/RecordSighting.command.ts";
import { CatalogStore } from "./CatalogStore.ts";

export class CatalogIndex extends Domain.Projection(
  "CatalogIndex",
  {
    from: [Item],
    key: Item,
    on: [SightingRecorded, ItemKept, ItemDropped],
  },
  {
    description:
      "Replay committed Item events into the replaceable catalog index.",
  }
) {}

export const CatalogIndexLive = CatalogIndex.toLayer(
  Effect.gen(function* catalogIndexHandler() {
    const store = yield* CatalogStore;

    return Effect.fn("CatalogIndex.record")(function* record(batch) {
      yield* store
        .record(
          batch.map(({ key, event, envelope }) => ({
            item: key.id,
            stream: envelope.stream,
            seq: envelope.seq,
            recordedAt: envelope.at,
            event,
          }))
        )
        .pipe(Effect.orDie);
    });
  })
);
