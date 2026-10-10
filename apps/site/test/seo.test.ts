import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  contentDates,
  pageTitle,
  structuredData,
} from "../scripts/seo-metadata.ts";
import { sitemapXml } from "../src/content.ts";
import {
  catalog,
  homeDocumentHtml,
  lawSources,
  loreSources,
  skillSources,
} from "./generated-content.ts";

const Publisher = Schema.Struct({
  "@type": Schema.Literal("Organization"),
  name: Schema.String,
  url: Schema.String,
});

const Article = Schema.Struct({
  "@context": Schema.Literal("https://schema.org"),
  "@type": Schema.Literal("TechArticle"),
  author: Publisher,
  dateModified: Schema.optional(Schema.String),
  datePublished: Schema.optional(Schema.String),
  description: Schema.String,
  headline: Schema.String,
  mainEntityOfPage: Schema.String,
  publisher: Publisher,
  url: Schema.String,
});

const jsonLd = (html: string) => {
  const blocks = [
    ...html.matchAll(
      /<script type="application\/ld\+json">(?<json>[^]*?)<\/script>/gu
    ),
  ];

  expect(blocks).toHaveLength(1);

  return blocks[0]?.groups?.json ?? "";
};

it.effect(
  "every generated lore and system article describes its visible content",
  () =>
    Effect.gen(function* checkArticleMetadata() {
      for (const page of loreSources) {
        const data = yield* Schema.decodeEffect(Schema.fromJsonString(Article))(
          jsonLd(page.documentHtml)
        );

        expect(data.headline).toBe(page.title);
        expect(data.description).toBe(page.description);
        expect(data.url).toBe(`__RATSTACK_ORIGIN__${page.routePath}`);
        expect(data.datePublished).toBe(page.datePublished);
        expect(data.dateModified).toBe(page.dateModified);

        if (data.dateModified !== undefined) {
          expect(page.documentHtml).toContain(
            `<time datetime="${data.dateModified}">${data.dateModified}</time>`
          );
        }

        expect(
          page.documentHtml.replaceAll(
            /<script type="application\/ld\+json">[^]*?<\/script>/gu,
            ""
          )
        ).not.toContain("<script");
        expect(page.documentHtml).not.toMatch(
          /AggregateRating|"@type":"Review"/u
        );
      }

      const website = yield* Schema.decodeEffect(
        Schema.fromJsonString(
          Schema.Struct({
            "@type": Schema.Literal("WebSite"),
            name: Schema.Literal("rat-stack"),
            url: Schema.String,
          })
        )
      )(jsonLd(homeDocumentHtml));

      expect(website.url).toBe("__RATSTACK_ORIGIN__");
    })
);

it.effect(
  "sitemap contains each canonical reader page and no discovery files",
  () =>
    Effect.sync(() => {
      const xml = sitemapXml("https://ratstack.sh", catalog);

      const paths = [
        ...xml.matchAll(/<loc>https:\/\/ratstack.sh(?<path>[^<]*)<\/loc>/gu),
      ].map((match) => match.groups?.path);

      expect(new Set(paths).size).toBe(paths.length);

      for (const page of [...lawSources, ...loreSources, ...skillSources]) {
        expect(paths.includes(page.routePath)).toBe(
          page.routePath !== "/log.md"
        );

        const entry = xml
          .split("<url>")
          .find((value) =>
            value.includes(`<loc>https://ratstack.sh${page.routePath}</loc>`)
          );

        const date = page.dateModified ?? page.datePublished;

        if (page.routePath === "/log.md") {
          continue;
        }

        if (date === undefined) {
          expect(entry).not.toContain("<lastmod>");
        } else {
          expect(entry).toContain(`<lastmod>${date}</lastmod>`);
        }
      }

      for (const path of ["/", "/lore", "/systems", "/skills", "/glossary"]) {
        expect(paths).toContain(path);
      }

      expect(
        paths.some((path) =>
          /(?:\.txt|\.json|\.xml|^\/auth\.md|^\/\.well-known|^\/tokenmaxx)/u.test(
            path ?? ""
          )
        )
      ).toBe(false);
    })
);

it.prop(
  "only content dates supply freshness; talk and build dates never do",
  {
    body: Arbitrary.schema(Schema.String),
    talkDate: Arbitrary.schema(Schema.String),
  },
  ({ talkDate, body }) => {
    const undated = `---\ndate: ${JSON.stringify(talkDate)}\nbuild_date: "2099-01-01"\n---\n${body}`;
    expect(contentDates(undated)).toStrictEqual({});
    expect(
      contentDates(
        `---\ncreated_at: "2026-09-01"\nupdated: "2026-10-02"\n---\n${body}`
      )
    ).toStrictEqual({
      dateModified: "2026-10-02",
      datePublished: "2026-09-01",
    });
  }
);

it.prop(
  "authored dates drive sitemap freshness independently of the build",
  {
    modified: Arbitrary.schema(
      Schema.Literals(["2026-10-03", "2026-10-04", "2026-10-05"])
    ),
    published: Arbitrary.schema(
      Schema.Literals(["2025-01-01", "2026-09-12", "2026-10-02"])
    ),
  },
  ({ published, modified }) => {
    const dates = contentDates(
      `---\ncreated_at: "${published}"\nupdated_at: "${modified}"\n---\n`
    );

    const dated = {
      ...catalog,
      resources: catalog.resources.map((page) => ({ ...page, ...dates })),
    };

    const xml = sitemapXml("https://ratstack.sh", dated);

    for (const page of dated.resources.filter(
      (entry) => entry.routePath !== "/log.md"
    )) {
      const entry = xml
        .split("<url>")
        .find((value) =>
          value.includes(`<loc>https://ratstack.sh${page.routePath}</loc>`)
        );

      expect(entry).toContain(`<lastmod>${modified}</lastmod>`);
      expect(entry).not.toContain(`<lastmod>${published}</lastmod>`);
    }

    expect(() =>
      contentDates('---\ncreated_at: "2026-02-30"\n---\n')
    ).toThrow();
  }
);

it.prop(
  "JSON-LD preserves arbitrary text without becoming executable markup",
  {
    text: Arbitrary.schema(Schema.String),
  },
  ({ text }) => {
    const title = `${text}</script><script>alert(1)</script>`;

    const html = structuredData({
      description: text,
      origin: "https://ratstack.sh",
      path: "/lore/example",
      title,
    });

    const data = Schema.decodeUnknownSync(Schema.fromJsonString(Article))(
      jsonLd(html)
    );

    expect(data.headline).toBe(title);
    expect(data.description).toBe(text);
    expect(html.match(/<script/gu)).toHaveLength(1);
  }
);

it.prop(
  "branding cannot push a fitting page title past sixty characters",
  {
    title: Arbitrary.schema(Schema.String),
  },
  ({ title }) => {
    const rendered = pageTitle(title);
    expect(rendered.startsWith(title)).toBe(true);

    if (title.length <= 60) {
      expect(rendered.length).toBeLessThanOrEqual(60);
    }

    if (rendered !== title) {
      expect(rendered.slice(title.length)).toBe(" | rat-stack");
    }
  }
);

it.effect(
  "source titles describe their job and long talk titles retain the headline",
  () =>
    Effect.sync(() => {
      for (const page of lawSources) {
        expect(page.title).not.toMatch(/^(?:[\w-]+\/)?[\w.-]+\.md$/u);
      }

      for (const page of loreSources) {
        const title =
          /<title>(?<title>[^]*?)<\/title>/u.exec(page.documentHtml)?.groups
            ?.title ?? "";

        if (page.title.length + " | rat-stack".length > 60) {
          expect(title).not.toContain(" | rat-stack");
        }
      }

      for (const route of [
        "/lore/one-program-can-replace-several-tool-calls",
        "/skills/learn-rat-stack",
      ]) {
        const page = [...loreSources, ...skillSources].find(
          (entry) => entry.routePath === route
        );

        expect(page?.documentHtml).not.toMatch(
          /href="(?:https:\/\/ratstack.sh)?\/api\/execute"/u
        );
        expect(page?.documentHtml).toContain(
          "/llms.txt#run-code-one-program-instead-of-several-calls"
        );
      }
    })
);
