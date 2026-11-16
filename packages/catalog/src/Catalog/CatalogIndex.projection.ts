import * as Domain from "@alchemy.run/domain";
import { Effect } from "effect";

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
      yield* Effect.forEach(
        ({ key, event, envelope }: (typeof batch)[number]) => {
          const row = {
            item: key.id,
            stream: envelope.stream,
            seq: envelope.seq,
            recordedAt: envelope.at,
            event,
          };

          return store.record([row]).pipe(
            Effect.catchTag("InvalidCatalogInput", (failure) =>
              store.quarantine(row, String(failure.cause).slice(0, 2048))
            ),
            Effect.orDie
          );
        }
      )(batch);
    });
  }),
  { batch: { size: 25 } }
);
