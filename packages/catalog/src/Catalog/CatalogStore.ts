import type * as Domain from "@alchemy.run/domain";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { CatalogUnavailable } from "./CatalogUnavailable.rejection.ts";
import type {
  CatalogEventRow,
  RepeatAuthorEntry,
  RepeatAuthorsInput,
  RisingEntry,
  RisingInput,
} from "./CatalogValues.ts";
import type { InvalidCatalogCursor } from "./InvalidCatalogCursor.rejection.ts";
import type { InvalidCatalogInput } from "./InvalidCatalogInput.rejection.ts";
import type { InvalidWindow } from "./InvalidWindow.rejection.ts";

type ReadFailure =
  | CatalogUnavailable
  | InvalidCatalogCursor
  | InvalidWindow
  | InvalidCatalogInput;

export class CatalogStore extends Context.Service<
  CatalogStore,
  {
    readonly quarantine: (
      row: typeof CatalogEventRow.Type,
      reason: string
    ) => Effect.Effect<void, CatalogUnavailable>;
    readonly record: (
      rows: readonly (typeof CatalogEventRow.Type)[]
    ) => Effect.Effect<void, CatalogUnavailable | InvalidCatalogInput>;
    readonly rising: (
      input: typeof RisingInput.Type,
      page: Domain.Query.PageRequest
    ) => Effect.Effect<Domain.Query.Page<typeof RisingEntry.Type>, ReadFailure>;
    readonly repeatAuthors: (
      input: typeof RepeatAuthorsInput.Type,
      page: Domain.Query.PageRequest
    ) => Effect.Effect<
      Domain.Query.Page<typeof RepeatAuthorEntry.Type>,
      ReadFailure
    >;
  }
>()("@rat-stack/catalog/CatalogStore") {}
