import { expect, it } from "@effect/vitest";
import { composePage } from "@rat-stack/core";
import { FeaturedSite, PageSpec } from "@rat-stack/core/contracts";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";

import { Flags } from "../src/client/featured.js";
import type { AppMessage } from "../src/client/model.js";
import { renderSpec } from "../src/features/render-spec.js";

const Text = FeaturedSite.fields.name;

const PageProps = Schema.Struct({ intro: Text, title: Text });

const CalloutProps = Schema.Struct({ text: Text, title: Text });

const Leaf = Schema.Union([
  Schema.Struct({ props: PageProps, type: Schema.Literal("Page") }),
  Schema.Struct({ props: Schema.Struct({}), type: Schema.Literal("Grid") }),
  Schema.Struct({ props: FeaturedSite, type: Schema.Literal("SiteCard") }),
]);

it.effect.prop(
  "every generated catalog tree renders all its cards and escaped text",
  {
    callout: CalloutProps,
    nodes: Arbitrary.array(Arbitrary.schema(Leaf), { maxLength: 20 }),
    page: PageProps,
  },
  ({ callout, nodes, page }) =>
    Effect.gen(function* renderCatalogTree() {
      const ids = nodes.map((_, index) => `node${index}`);

      const spec = PageSpec.make({
        elements: {
          ...Object.fromEntries(
            nodes.map((node, index) => [
              `node${index}`,
              { ...node, children: [] },
            ])
          ),
          note: { children: [], props: callout, type: "Callout" },
          root: { children: [...ids, "note"], props: page, type: "Page" },
        },
        root: "root",
      });

      const validated = yield* composePage.handler({ spec });

      const rendered = yield* renderToString(
        {
          Flags,
          init: (flags: typeof Flags.Type) => ({ model: flags.featured }),
          view: (model, h: HtmlBuilder<AppMessage>) => ({
            body: renderSpec(model.spec, model, h),
            title: page.title,
          }),
        },
        {
          flags: {
            featured: { featuredSites: [], showNote: true, spec: validated },
          },
          isHydratable: false,
        }
      );

      expect((rendered.html.match(/<article\b/gu) ?? []).length).toBe(
        nodes.filter((node) => node.type === "SiteCard").length
      );
      expect((rendered.html.match(/<aside\b/gu) ?? []).length).toBe(1);
      expect(rendered.title).toBe(page.title);
      expect(rendered.html).not.toContain("<script");
    })
);

it.effect.prop(
  "a state-bound card reads the prerender model and preserves its destination",
  { site: FeaturedSite },
  ({ site }) =>
    Effect.gen(function* renderBoundSite() {
      const spec = PageSpec.make({
        elements: {
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
        },
        root: "site",
      });

      const rendered = yield* renderToString(
        {
          Flags,
          init: (flags: typeof Flags.Type) => ({ model: flags.featured }),
          view: (model, h: HtmlBuilder<AppMessage>) => ({
            body: renderSpec(model.spec, model, h),
            title: site.name,
          }),
        },
        {
          flags: { featured: { featuredSites: [site], showNote: true, spec } },
          isHydratable: false,
        }
      );

      expect(rendered.html).toContain("<article");
      expect(rendered.html).toContain("href=");
      expect(rendered.title).toBe(site.name);
    })
);
