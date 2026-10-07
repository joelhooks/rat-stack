import { implement } from "@rat-stack/capability/implement";
import {
  decodeFeaturedSites,
  featuredSitesContract,
} from "@rat-stack/core/contracts";
import { Effect } from "effect";

import source from "../../../../.brain/data/featured-sites.json" with { type: "json" };

const sites = decodeFeaturedSites(source);

export const featuredSites = implement(featuredSitesContract, () =>
  Effect.succeed(sites)
);
