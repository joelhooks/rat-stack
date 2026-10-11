import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  addInboundCounts,
  backlinkContext,
  buildBacklinkIndex,
} from "../scripts/backlink-lib.ts";
import {
  createComponentRegistry,
  renderSvxMarkdown,
} from "../scripts/component-registry.ts";
import { linkedFromComponent } from "../scripts/reference-components.ts";
import { parseContentMarkdown, visitContentNodes } from "../scripts/svx-ast.ts";
import {
  loreSources,
  skillSources,
  lawSources,
  loreGraphSnapshot,
} from "./generated-content.js";

it.effect(
  "counts unique referencing pages and leaves self-links and non-prose alone",
  () =>
    Effect.sync(() => {
      const pages = [
        {
          bodyHtml: '<p>See <a href="/lore/b">B</a>.</p>',
          description: "First",
          route: "/lore/a",
          title: "A",
        },
        { bodyHtml: "", description: "Second", route: "/lore/b", title: "B" },
        {
          bodyHtml: '<p>Read <a href="/lore/b">B</a>.</p>',
          description: "Third",
          route: "/skills/c",
          title: "C",
        },
      ];

      const links = [
        { from: "/lore/a", to: "/lore/b" },
        { from: "/lore/a", to: "/lore/b" },
        { from: "/lore/b", to: "/lore/b" },
        { from: "/skills/c", to: "/lore/b" },
      ];

      const index = buildBacklinkIndex(pages, links);
      expect(index.get("/lore/b")).toHaveLength(2);
      const link = '<a href="/lore/b">B</a>';
      expect(addInboundCounts(`<p>${link}</p>`, "/lore/a", index)).toContain(
        'aria-label="2 pages link here"'
      );
      expect(addInboundCounts(link, "/lore/b", index)).toBe(link);

      for (const tag of [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "nav",
        "table",
        "code",
        "pre",
      ]) {
        const html = `<${tag}>${link}</${tag}><p>${link}</p>`;
        expect(
          addInboundCounts(html, "/lore/a", index).match(/inbound-count/gu)
        ).toHaveLength(1);
      }

      expect(
        addInboundCounts(
          link,
          "/lore/a",
          buildBacklinkIndex(pages, links.slice(0, 1))
        )
      ).toBe(link);
    })
);

it.effect(
  "previews real link context as escaped text with native expansion",
  () =>
    Effect.sync(() => {
      const context = backlinkContext(
        '<p>Earlier sentence. The &lt;script&gt; &amp; "quoted" <a href="/lore/b">B</a> explains this. Later sentence.</p>',
        "/lore/b"
      );

      expect(context).toBe('The <script> & "quoted" B explains this.');

      const entry = {
        context,
        description: "One-line summary",
        route: "/lore/a",
        title: "A <title>",
      };

      const registry = createComponentRegistry({
        LinkedFrom: linkedFromComponent(new Map([["/lore/b", [entry]]])),
      });

      const source = '<LinkedFrom page="/lore/b" />';

      const rendered = {
        html: renderSvxMarkdown(source, "human", {}, registry),
        markdown: renderSvxMarkdown(source, "agent", {}, registry),
      };

      expect(rendered.html).toContain(
        "&lt;script&gt; &amp; &quot;quoted&quot;"
      );
      expect(rendered.html).not.toContain("<script>");
      expect(rendered.markdown).toContain("→ One-line summary → [Read page]");
      expect(rendered.markdown).not.toMatch(/<sup|inbound-count/u);
      expect(
        renderSvxMarkdown(
          source,
          "human",
          {},
          createComponentRegistry({
            LinkedFrom: linkedFromComponent(
              new Map([["/lore/b", [{ ...entry, context: context.repeat(8) }]]])
            ),
          })
        )
      ).toContain("<details><summary>Link context</summary>");
    })
);

it.effect("published counts and reference lists agree with the graph", () =>
  Effect.sync(() => {
    const origin = "https://ratstack.sh";

    for (const page of [...loreSources, ...skillSources, ...lawSources]) {
      const incoming = new Set(
        loreGraphSnapshot.edges
          .filter(
            (edge) =>
              edge.kind === "link" &&
              edge.to.url === `${origin}${page.routePath}` &&
              edge.from.url !== edge.to.url
          )
          .map((edge) => edge.from.url)
      );

      const publishedLinks = new Set<string>();
      visitContentNodes(parseContentMarkdown(page.text), (node) => {
        if (node.type === "link") {
          publishedLinks.add(node.url);
        }
      });

      for (const url of incoming) {
        expect(publishedLinks, page.routePath).toContain(url);
      }

      expect(page.text).not.toContain("<sup");

      for (const match of page.documentHtml.matchAll(
        /<sup class="inbound-count"><a href="(?<route>[^#]+)#linked-from" aria-label="(?<count>\d+) pages link here">/gu
      )) {
        const target = match.groups?.route;

        const references = new Set(
          loreGraphSnapshot.edges
            .filter(
              (edge) =>
                edge.kind === "link" &&
                edge.to.url === `${origin}${target}` &&
                edge.from.url !== edge.to.url
            )
            .map((edge) => edge.from.url)
        );

        expect(Number(match.groups?.count)).toBe(references.size);
        expect(references.size).toBeGreaterThan(1);
        expect(target).not.toBe(page.routePath);
      }
    }
  })
);
