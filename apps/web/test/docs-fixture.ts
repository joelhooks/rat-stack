import type { SearchOutput } from "@rat-stack/core/contracts";

import { Model, ReadState, SearchState } from "../src/client/docs/model.js";
import { AppRoute } from "../src/features/route.js";

export const docsHome = Model.make({
  generation: 0,
  query: "capability",
  read: ReadState.Idle(),
  route: AppRoute.Home(),
  search: SearchState.Idle(),
});

export const docsResult = (title: string) =>
  ({
    matches: [
      {
        description: "A shared contract.",
        digest: "fixture",
        excerpt: "Define one contract.",
        id: `lore:${title}`,
        kind: "lore",
        routePath: `/lore/${title}`,
        score: 1,
        title,
      },
    ],
    total: 1,
  }) satisfies typeof SearchOutput.Type;
