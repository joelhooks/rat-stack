import * as Domain from "@alchemy.run/domain";

export class InvalidCatalogCursor extends Domain.Rejection(
  "InvalidCatalogCursor",
  {},
  {
    description:
      "Use a cursor from this Query with the same filters, or restart without after.",
  }
) {}
