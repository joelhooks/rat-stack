import * as Domain from "@alchemy.run/domain";

import { Catalog } from "./Catalog.model.ts";

export class OperatorApi extends Domain.Api(
  "CatalogOperatorApi",
  {
    model: Catalog,
    commands: ["RecordSighting", "Keep", "Drop"],
    views: ["ItemHistory"],
    streams: [],
    queries: [],
  },
  {
    description:
      "Authenticated operator access to private observations and decisions.",
  }
) {}
