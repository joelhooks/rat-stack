import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class InvalidCatalogInput extends Domain.Rejection(
  "InvalidCatalogInput",
  {
    operation: Schema.Literals(["record", "rising", "repeatAuthors"]),
    cause: Schema.Defect(),
  }
) {}
