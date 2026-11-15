import * as Domain from "@alchemy.run/domain";

import { Item } from "./Item/Item.aggregate.ts";
import { ItemHistory, ItemHistoryLive } from "./Item/ItemHistory.view.ts";

export class Catalog extends Domain.Model(
  "Catalog",
  { aggregates: [Item], views: [ItemHistory] },
  {
    description:
      "Private monitoring history; recording a decision never publishes content.",
  }
) {}

export const CatalogHandlers = ItemHistoryLive;
