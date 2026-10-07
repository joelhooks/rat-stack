import { expect, it } from "@effect/vitest";
import { FeaturedSite } from "@rat-stack/core/contracts";
import { Effect, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { featuredSpec } from "../src/client/featured.js";
import { ReaderFlags, readerInit } from "../src/client/reader-model.js";
import { readerView } from "../src/features/reader.js";

it.effect.prop(
  "the showcase uses one reader shell and its native state visibility without JavaScript",
  { showNote: Schema.Boolean, site: FeaturedSite },
  ({ site, showNote }) =>
    Effect.gen(function* renderShowcaseShell() {
      const flags = ReaderFlags.make({
        bibliography: [],
        blocks: [],
        codeFences: [],
        copyPrompts: [],
        featured: { featuredSites: [site], showNote, spec: featuredSpec },
        heading: "Built with rat-stack",
        origin: "https://example.test",
        page: {
          generation: "a".repeat(64),
          metadata: {
            canonicalPath: "/featured",
            description: "Sites.",
            discoveryLinks: [],
            jsonLd: "none",
            ogImagePath: "/og.svg",
            robots: "noindex",
            title: "Featured sites | rat-stack",
          },
          path: "/featured",
          sourcePath: ".brain/data/featured-sites.json",
          status: 200,
        },
        snippets: [],
        terms: [],
        workshop: {
          href: "/join",
          label: "Workshop",
          line: "Build with Effect.",
          link: "Apply",
          note: "Learn.",
        },
      });

      const rendered = yield* renderToString(
        { Flags: ReaderFlags, init: readerInit, view: readerView },
        { flags, isHydratable: false }
      );

      expect((rendered.html.match(/<main\b/gu) ?? []).length).toBe(1);
      expect((rendered.html.match(/<header\b/gu) ?? []).length).toBe(1);
      expect((rendered.html.match(/<footer\b/gu) ?? []).length).toBe(1);
      expect((rendered.html.match(/<article\b/gu) ?? []).length).toBe(1);
      expect((rendered.html.match(/<aside\b/gu) ?? []).length).toBe(
        showNote ? 1 : 0
      );
      expect(rendered.html).toContain('href="/featured"');
      expect(rendered.html).toContain('href="/llms.txt"');
      expect(rendered.html).not.toContain("<script");
      expect(rendered.canonical).toBe("https://example.test/featured");
    })
);
