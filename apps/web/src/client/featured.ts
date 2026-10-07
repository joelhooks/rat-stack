import {
  decodeFeaturedSites,
  FeaturedSites,
  PageSpec,
} from "@rat-stack/core/contracts";
import { Schema } from "effect";

import source from "../../../../.brain/data/featured-sites.json" with { type: "json" };

export const FeaturedModel = Schema.Struct({
  featuredSites: FeaturedSites,
  showNote: Schema.Boolean,
  spec: PageSpec,
});

export const Flags = Schema.Struct({ featured: FeaturedModel });

export const featuredSpec = PageSpec.make({
  elements: {
    note: {
      children: [],
      props: {
        text: "Four typed components. One JSON spec. This page renders before JavaScript runs.",
        title: "A page from a spec",
      },
      type: "Callout",
      visible: { $state: "/showNote" },
    },
    page: {
      children: ["sites", "note"],
      props: {
        intro: "Good things people build. Start with one worth visiting.",
        title: "Built with rat-stack",
      },
      type: "Page",
    },
    site: {
      children: [],
      props: {
        author: { $state: "/featuredSites/0/author" },
        description: { $state: "/featuredSites/0/description" },
        name: { $state: "/featuredSites/0/name" },
        stack: { $state: "/featuredSites/0/stack" },
        url: { $state: "/featuredSites/0/url" },
      },
      type: "SiteCard",
    },
    sites: { children: ["site"], props: {}, type: "Grid" },
  },
  root: "page",
});

export const featuredFlags = Flags.make({
  featured: {
    featuredSites: decodeFeaturedSites(source),
    showNote: true,
    spec: featuredSpec,
  },
});
