import type { SearchOutput } from "@rat-stack/core/contracts";
import { Option } from "effect";

import {
  initialModel as docsInitialModel,
  Model,
  ReadState,
  SearchState,
} from "../src/client/docs/model.js";
import { initialModel } from "../src/client/reader/model.js";
import { AppRoute } from "../src/features/route.js";
import { readerFlagsFixture } from "./reader-fixture.js";

export const docsHome = Model.make({
  generation: 0,
  query: "capability",
  read: ReadState.Idle(),
  route: AppRoute.Search({ q: Option.none() }),
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

export const searchPage = initialModel({
  ...readerFlagsFixture,
  blocks: [],
  copyPrompts: [],
  docs: Option.some(docsInitialModel),
  heading: "Search the docs",
  page: {
    ...readerFlagsFixture.page,
    metadata: {
      ...readerFlagsFixture.page.metadata,
      canonicalPath: "/search",
      title: "Search the docs | rat-stack",
    },
    path: "/search",
  },
});
