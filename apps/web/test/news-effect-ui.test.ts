import { NodeServices } from "@effect/platform-node";
import { HtmlLocator, HtmlScene, ssr } from "@effect/ui/html/testing";
import { Locator, TestHost } from "@effect/ui/testing";
import { expect, it } from "@effect/vitest";
import { CafeNewsItem, IsoDate } from "@rat-stack/core/contracts";
import type { CafeNewsItemValue } from "@rat-stack/core/contracts";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { NewsPage } from "../src/client/news-effect-ui/component.js";
import { hydrateNews } from "../src/client/news-effect-ui/hydration.js";
import {
  NewsHandoff,
  newsHandoffId,
  newsRootId,
} from "../src/client/news-effect-ui/model.js";
import { CafePage, ReaderSource } from "../src/reader-cafe.js";
import { renderNewsPage } from "../src/server/news-effect-ui.js";
import {
  renderDocument,
  withReaderHead,
} from "../src/server/reader-document.js";
import { ReaderErrorTemplate } from "../src/server/reader-error-template.js";
import {
  renderNewsOrError,
  renderReaderError,
} from "../src/server/reader-render.js";
import { cafeParity } from "./cafe-parity.js";
import legacyNews from "./fixtures/foldkit-news-parity.json";

const latestLink = HtmlLocator.role("link", { name: "Latest first" });

const rankLink = HtmlLocator.role("link", { name: "Ranked by interest" });

const sortHeading = Locator.text("How this list is sorted");

it.effect("both orders offer a native link to the other route", () =>
  Effect.gen(function* orderLinks() {
    const latest = yield* HtmlScene.make(NewsPage, {
      items: [],
      profiles: [],
      sort: "newest",
    });

    latest.expect(rankLink).toHaveAttribute("href", "/news");
    latest.expect(sortHeading).toBeAbsent();

    const rank = yield* HtmlScene.make(NewsPage, {
      items: [],
      profiles: [],
      sort: "rank",
    });

    rank.expect(latestLink).toHaveAttribute("href", "/news/latest");
    rank.expect(sortHeading).toExist();
  })
);

const parseMarkup = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

const textWithoutWhitespace = (node: Element) =>
  (node.textContent ?? "").replaceAll(/\s+/gu, "");

const rowText = (document: Document) =>
  [...document.querySelectorAll("main ol > li")].map(textWithoutWhitespace);

const newsRowLinks = (root: ParentNode) =>
  [...root.querySelectorAll("ol > li > article > p:first-child > a")].map(
    (link) => link.getAttribute("href")
  );

const readerPages = Effect.gen(function* readerPages() {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;

  const source = yield* fs.readFileString(
    paths.resolve(import.meta.dirname, "../dist/reader-pages.json")
  );

  return yield* Schema.decodeEffect(
    Schema.fromJsonString(Schema.Array(ReaderSource))
  )(source);
});

const newsFixture = (
  items: readonly CafeNewsItemValue[],
  sort: "rank" | "newest"
) => {
  const path = sort === "rank" ? "/news" : "/news/latest";

  return Schema.decodeSync(ReaderSource)({
    bibliography: [],
    blocks: [],
    cafe: CafePage.cases.News.make({
      items,
      profiles: [],
      rankedAt: Schema.decodeSync(IsoDate)("2026-11-26"),
      sort,
    }),
    codeFences: [],
    copyPrompts: [],
    heading: "News fixture",
    origin: "https://ratstack.sh",
    page: {
      generation: "0".repeat(64),
      metadata: {
        canonicalPath: path,
        description: "News fixture",
        discoveryLinks: [],
        jsonLd: "none",
        ogImagePath: "/og.png",
        robots: "noindex",
        title: "News fixture",
      },
      path,
      sourcePath: ".brain/data/cafe/news.json",
      status: 200,
    },
    snippets: [],
    terms: [],
  });
};

const stylesheets = (document: Document) =>
  [...document.head.querySelectorAll('link[rel="stylesheet"][href]')].flatMap(
    (tag) => {
      const href = tag.getAttribute("href");

      return href === null ? [] : [href];
    }
  );

const newsScript = (document: Document) =>
  document.querySelector('script[type="module"]')?.getAttribute("src");

const newsAssets = {
  entryScript: "/assets/news-effect-ui-test.js",
  modulePreloads: [],
  stylesheets: [],
};

const probe =
  "</script><!-- <span data-news-escape-probe> & \" ' \u2028 \u2029 end";

const generatedNews = (nonce: number): readonly CafeNewsItemValue[] => {
  const story = {
    author: { github: null, x: null },
    date: "2026-11-23",
    kind: "post",
    repo: null,
    source: `https://example.com/source/${nonce}`,
    summary: `Summary ${nonce} ${probe}`,
    title: `Title ${nonce} ${probe}`,
    url: `https://example.com/news/${nonce}`,
  };

  const thread = {
    ...story,
    author: { github: null, x: "tester" },
    date: "2026-11-25",
    engagement: { likes: nonce, participants: 1, replies: 1 },
    kind: "thread",
    topReplies: [],
    url: `https://x.com/tester/status/${nonce}`,
  };

  return Schema.decodeUnknownSync(Schema.Array(CafeNewsItem))([
    story,
    thread,
    {
      ...thread,
      interest: {
        editorial: nonce % 4,
        substance: "proof",
        topic: "topic",
        why: `Shows case ${nonce}`,
      },
      date: "2026-11-24",
      title: `Thread ${nonce} ${probe}`,
      topReplies: [
        {
          likes: nonce,
          text: `Reply ${nonce} ${probe}`,
          url: `https://x.com/replier/status/${nonce}`,
          x: "replier",
        },
      ],
      url: `https://x.com/tester/status/${nonce + 1}`,
    },
  ]);
};

it.live("news text and styles match the captured Foldkit fixtures", () =>
  Effect.gen(function* newsParity() {
    const ranked = generatedNews(42);

    const latest = ranked.toSorted((left, right) =>
      right.date.localeCompare(left.date)
    );

    const cases = [
      { expected: legacyNews.rank, page: newsFixture(ranked, "rank") },
      { expected: legacyNews.latest, page: newsFixture(latest, "newest") },
    ];

    for (const { expected, page } of cases) {
      const cafe = yield* page.cafe.pipe(
        Option.filter(CafePage.guards.News),
        Effect.fromOption
      );

      const rendered = yield* renderNewsPage(page, cafe, newsAssets);
      const html = renderDocument(withReaderHead(rendered, page), newsAssets);

      expect(cafeParity(parseMarkup(html), "main ol > li")).toEqual(expected);
    }
  })
);

it.live.prop(
  "generated news preserves source order, titles and the inert handoff",
  {
    newest: Schema.Boolean,
    nonce: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 1_000_000, minimum: 1 }))
    ),
  },
  ({ newest, nonce }) =>
    Effect.gen(function* generatedNewsParity() {
      const sort = newest ? "newest" : "rank";
      const generated = generatedNews(nonce);

      const items = newest
        ? generated.toSorted((left, right) =>
            right.date.localeCompare(left.date)
          )
        : generated;

      const flags = newsFixture(items, sort);

      const cafe = yield* flags.cafe.pipe(
        Option.filter(CafePage.guards.News),
        Effect.fromOption
      );

      const application = yield* renderNewsPage(flags, cafe, newsAssets);

      const output = renderDocument(withReaderHead(application, flags), {
        ...newsAssets,
        stylesheets: [],
      });

      const actual = parseMarkup(output);

      expect(newsRowLinks(actual)).toEqual(items.map(({ url }) => url));
      expect(
        [
          ...actual.querySelectorAll("ol > li > article > p:first-child > a"),
        ].map(textWithoutWhitespace)
      ).toEqual(items.map(({ title }) => title.replaceAll(/\s+/gu, "")));
      expect(actual.querySelector("[data-news-escape-probe]")).toBeNull();

      const payload = actual.querySelectorAll(
        `script#${newsHandoffId}[type="application/json"]`
      );

      expect(payload).toHaveLength(1);
      const json = payload[0]?.textContent ?? "";
      expect(json).not.toMatch(/[<\u2028\u2029]/u);

      const restored = yield* Schema.decodeEffect(
        Schema.fromJsonString(NewsHandoff)
      )(json);

      expect(restored.props).toEqual({ items, profiles: [], sort });
    }),
  { arbitrary: { runs: 30 } }
);

it.live(
  "both a missing News cafe and a rejected loader render the site's 500 template",
  () =>
    Effect.gen(function* failedNewsRender() {
      const fs = yield* FileSystem.FileSystem;
      const paths = yield* Path.Path;
      const page = newsFixture([], "rank");

      const source = yield* fs.readFileString(
        paths.resolve(import.meta.dirname, "../dist/reader-error.json")
      );

      const template = yield* Schema.decodeEffect(
        Schema.fromJsonString(ReaderErrorTemplate)
      )(source);

      for (const flags of [{ ...page, cafe: Option.none() }, page]) {
        const { application, status } = yield* renderNewsOrError(
          flags,
          newsAssets,
          () => Promise.reject(new Error("unavailable chunk")),
          (error) => renderReaderError(template, error, "test-reader-build")
        );

        const document = parseMarkup(
          renderDocument(application, { ...newsAssets, stylesheets: [] })
        );

        expect(status).toBe(500);
        expect(document.querySelector("main h1")?.textContent).toContain(
          "News could not load"
        );
        expect(document.querySelector("main")?.textContent).toContain(
          "Try again in a moment"
        );
        expect(document.querySelector(`#${newsHandoffId}`)).toBeNull();
        expect(document.querySelector('header a[href="/"]')).not.toBeNull();
      }
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect("absent and invalid handoffs leave the server news readable", () =>
  Effect.gen(function* unreadableHandoffs() {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;

    const html = yield* fs.readFileString(
      paths.resolve(import.meta.dirname, "../dist/client/news/index.html")
    );

    for (const corrupt of [false, true]) {
      const document = parseMarkup(html);
      const payload = document.querySelector(`#${newsHandoffId}`);
      expect(payload).not.toBeNull();

      if (corrupt && payload !== null) {
        payload.textContent = '{"props":false}';
      } else {
        payload?.remove();
      }

      const root = document.querySelector<HTMLDivElement>(`#${newsRootId}`);
      const rows = rowText(document);
      expect(rows.length).toBeGreaterThan(0);
      yield* hydrateNews(document).pipe(Effect.scoped);
      expect(document.querySelector(`#${newsRootId}`)).toBe(root);
      expect(root?.dataset.hydrated).toBeUndefined();
      expect(rowText(document)).toEqual(rows);
    }
  }).pipe(Effect.provide(NodeServices.layer))
);

it.layer(TestHost.layer())("news with committed data", (test) => {
  test.effect(
    "the built news renders the catalog order and adopts its server DOM",
    () =>
      Effect.gen(function* renderCommittedNews() {
        const fs = yield* FileSystem.FileSystem;
        const paths = yield* Path.Path;

        const pages = yield* readerPages;

        const home = parseMarkup(
          yield* fs.readFileString(
            paths.resolve(import.meta.dirname, "../dist/client/index.html")
          )
        );

        const files = yield* fs.readDirectory(
          paths.resolve(import.meta.dirname, "../dist/client/assets")
        );

        const primaryNews = home.querySelector('header a[href="/news"]');
        expect(primaryNews?.textContent).toBe("news");
        expect(primaryNews?.getAttribute("onclick")).toBeNull();
        expect(home.querySelector("[data-foldkit-app]")).not.toBeNull();

        const rankHtml = yield* fs.readFileString(
          paths.resolve(import.meta.dirname, "../dist/client/news/index.html")
        );

        const latestHtml = yield* fs.readFileString(
          paths.resolve(
            import.meta.dirname,
            "../dist/client/news/latest/index.html"
          )
        );

        for (const { path, html } of [
          { html: rankHtml, path: "/news" },
          { html: latestHtml, path: "/news/latest" },
        ]) {
          const page = yield* Effect.fromOption(
            Option.fromNullishOr(
              pages.find((entry) => entry.page.path === path)
            )
          );

          const cafe = yield* page.cafe.pipe(
            Option.filter(CafePage.guards.News),
            Effect.fromOption
          );

          const pilotDocument = parseMarkup(html);
          const entry = newsScript(pilotDocument);

          expect(html).not.toMatch(/(?:src|href)="\/src\//u);
          expect(entry).toMatch(/^\/assets\/news-effect-ui-[\w-]+\.js$/u);
          expect(files).toContain(entry?.replace("/assets/", ""));
          expect(entry).not.toBe(newsScript(home));

          const preloads = [
            ...pilotDocument.querySelectorAll('link[rel="modulepreload"]'),
          ];

          expect(preloads.length).toBeGreaterThan(0);

          for (const preload of preloads) {
            expect(files).toContain(
              preload.getAttribute("href")?.replace("/assets/", "")
            );
          }

          expect(stylesheets(pilotDocument)).toEqual(stylesheets(home));
          expect(pilotDocument.title).toBe(page.page.metadata.title);
          expect(
            pilotDocument
              .querySelector("link[rel=canonical]")
              ?.getAttribute("href")
          ).toBe(`${page.origin}${page.page.metadata.canonicalPath}`);
          expect(
            pilotDocument.querySelectorAll(
              "title, link[rel=canonical], meta[name=description]"
            )
          ).toHaveLength(3);
          expect(
            pilotDocument.querySelector(`#${newsRootId} ol`)
          ).not.toBeNull();
          expect(
            pilotDocument.querySelector(`script#${newsHandoffId}`)
          ).not.toBeNull();
          expect(
            pilotDocument.querySelector(
              "[data-foldkit-app], [data-foldkit-flags]"
            )
          ).toBeNull();

          const expectedUrls = cafe.items.map(({ url }) => url);
          expect(expectedUrls.length).toBeGreaterThan(0);
          expect(newsRowLinks(pilotDocument)).toEqual(expectedUrls);

          const hydrated = yield* ssr(NewsPage, cafe);
          expect(hydrated.adopted).toEqual(["/NewsPage"]);
          expect(newsRowLinks(hydrated.container)).toEqual(expectedUrls);
        }
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
