import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { Operator } from "../Operator.context.ts";
import { OperatorToken, Unauthorized } from "../Operator.middleware.ts";
import { CatalogIndex } from "./CatalogIndex.projection.ts";
import { CatalogStore } from "./CatalogStore.ts";
import { CatalogUnavailable } from "./CatalogUnavailable.rejection.ts";
import { queryTake, RisingEntry, RisingInput } from "./CatalogValues.ts";
import { InvalidCatalogCursor } from "./InvalidCatalogCursor.rejection.ts";
import { InvalidCatalogInput } from "./InvalidCatalogInput.rejection.ts";
import { InvalidWindow } from "./InvalidWindow.rejection.ts";

export class Rising extends Domain.Query(
  "Rising",
  {
    input: RisingInput.fields,
    success: RisingEntry,
    paged: true,
    waitsFor: [CatalogIndex],
    middleware: [OperatorToken],
    rejects: [
      Unauthorized,
      CatalogUnavailable,
      InvalidWindow,
      InvalidCatalogCursor,
      InvalidCatalogInput,
    ],
  },
  {
    description:
      "Rank positive star or view gains between measured endpoints within at most 30 UTC days; compare within each source and return the strongest source per item.",
  }
) {}

export const RisingLive = Rising.toLayer(
  Effect.gen(function* risingHandler() {
    const store = yield* CatalogStore;

    return Effect.fn("Rising.handle")(function* handle(input, page) {
      if (Option.isNone(yield* Effect.serviceOption(Operator))) {
        return yield* new Unauthorized();
      }

      return yield* store.rising(input, page);
    });
  }),
  { take: queryTake }
);
