import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { Operator } from "../Operator.context.ts";
import { OperatorToken, Unauthorized } from "../Operator.middleware.ts";
import { CatalogIndex } from "./CatalogIndex.projection.ts";
import { CatalogStore } from "./CatalogStore.ts";
import { CatalogUnavailable } from "./CatalogUnavailable.rejection.ts";
import {
  queryTake,
  RepeatAuthorEntry,
  RepeatAuthorsInput,
} from "./CatalogValues.ts";
import { InvalidCatalogCursor } from "./InvalidCatalogCursor.rejection.ts";
import { InvalidCatalogInput } from "./InvalidCatalogInput.rejection.ts";
import { InvalidWindow } from "./InvalidWindow.rejection.ts";

export class RepeatAuthors extends Domain.Query(
  "RepeatAuthors",
  {
    input: RepeatAuthorsInput.fields,
    success: RepeatAuthorEntry,
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
      "Count distinct canonical item URLs per exact author handle within at most 30 UTC days, excluding up to 500 caller-supplied handles. Automatic admission exclusion waits for Person.",
  }
) {}

export const RepeatAuthorsLive = RepeatAuthors.toLayer(
  Effect.gen(function* repeatAuthorsHandler() {
    const store = yield* CatalogStore;

    return Effect.fn("RepeatAuthors.handle")(function* handle(input, page) {
      if (Option.isNone(yield* Effect.serviceOption(Operator))) {
        return yield* new Unauthorized();
      }

      return yield* store.repeatAuthors(input, page);
    });
  }),
  { take: queryTake }
);
