import { implement } from "@rat-stack/capability/implement";
import {
  backlinksContract,
  mentionsContract,
  neighborsContract,
  pathContract,
} from "@rat-stack/core/contracts";
import { Effect } from "effect";

import { ContentStore } from "../content-store.js";

export const backlinks = implement(backlinksContract, ({ slug }) =>
  ContentStore.use((store) => store.graph).pipe(
    Effect.flatMap((graph) => graph.backlinks(slug))
  )
);

export const neighbors = implement(neighborsContract, ({ depth, slug }) =>
  ContentStore.use((store) => store.graph).pipe(
    Effect.flatMap((graph) => graph.neighbors(slug, depth))
  )
);

export const mentions = implement(mentionsContract, ({ slug }) =>
  ContentStore.use((store) => store.graph).pipe(
    Effect.flatMap((graph) => graph.mentions(slug))
  )
);

export const path = implement(pathContract, ({ from, to }) =>
  ContentStore.use((store) => store.graph).pipe(
    Effect.flatMap((graph) => graph.path(from, to))
  )
);
