import * as Domain from "@alchemy.run/domain";
import * as Layer from "effect/Layer";

import {
  CatalogIndex,
  CatalogIndexLive,
} from "./Catalog/CatalogIndex.projection.ts";
import {
  RepeatAuthors,
  RepeatAuthorsLive,
} from "./Catalog/RepeatAuthors.query.ts";
import { Rising, RisingLive } from "./Catalog/Rising.query.ts";
import { Item } from "./Item/Item.aggregate.ts";
import { ItemHistory, ItemHistoryLive } from "./Item/ItemHistory.view.ts";

export class Catalog extends Domain.Model(
  "Catalog",
  {
    aggregates: [Item],
    views: [ItemHistory],
    projections: [CatalogIndex],
    queries: [Rising, RepeatAuthors],
  },
  {
    description:
      "Private monitoring history; recording a decision never publishes content.",
  }
) {}

export const CatalogHandlers = Layer.mergeAll(
  ItemHistoryLive,
  CatalogIndexLive,
  RisingLive,
  RepeatAuthorsLive
);
