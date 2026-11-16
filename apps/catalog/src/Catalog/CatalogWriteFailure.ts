import { CatalogUnavailable } from "@rat-stack/catalog/Catalog/CatalogUnavailable.rejection";
import { InvalidCatalogInput } from "@rat-stack/catalog/Catalog/InvalidCatalogInput.rejection";
import * as Cause from "effect/Cause";

export const catalogWriteFailure = (cause: Cause.Cause<unknown>) =>
  /\bSQLITE_TOOBIG\b/u.test(Cause.pretty(cause))
    ? new InvalidCatalogInput({ operation: "record", cause })
    : new CatalogUnavailable({ operation: "record", cause });
