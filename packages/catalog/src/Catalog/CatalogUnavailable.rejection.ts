import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export class CatalogUnavailable extends Domain.Rejection(
  "CatalogUnavailable",
  {
    operation: Schema.Literals(["record", "rising", "repeatAuthors"]),
    cause: Schema.Defect(),
  },
  {
    description:
      "The catalog index could not complete this operation. Check its D1 binding, migrations and source cause before retrying.",
  }
) {}
