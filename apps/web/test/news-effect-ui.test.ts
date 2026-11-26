import { NodeServices } from "@effect/platform-node";
import { HtmlLocator, HtmlScene, ssr } from "@effect/ui/html/testing";
import { Locator, TestHost } from "@effect/ui/testing";
import { expect, it } from "@effect/vitest";
import { CafeNewsItem, IsoDate } from "@rat-stack/core/contracts";
import type { CafeNewsItemValue } from "@rat-stack/core/contracts";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { renderToString } from "foldkit/experimental/server";

import { Model as CafeModel } from "../src/client/cafe/model.js";
import { NewsPage } from "../src/client/news-effect-ui/component.js";
import { hydrateNews } from "../src/client/news-effect-ui/hydration.js";
import {
  NewsHandoff,
  newsHandoffId,
  newsRootId,
} from "../src/client/news-effect-ui/model.js";
import { init } from "../src/client/reader/init.js";
import { ReaderFlags } from "../src/client/reader/model.js";
import { view } from "../src/features/reader.js";
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

const visibleText = (document: Document) =>
  [...document.querySelectorAll("header, main, footer")].map(
    textWithoutWhitespace
  );

const linksAndStyles = (document: Document) =>
  [
    ...document.querySelectorAll(
      "a, [class], section[id], [aria-labelledby], time, details, summary"
    ),
  ].map((element) => [
    element.localName,
    ...[
      "href",
      "rel",
      "aria-label",
      "aria-labelledby",
      "id",
      "class",
      "datetime",
      "open",
    ].map((key) => element.getAttribute(key)),
  ]);

const readerPages = Effect.gen(function* readerPages() {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;

  const source = yield* fs.readFileString(
    paths.resolve(import.meta.dirname, "../dist/reader-pages.json")
  );

  return yield* Schema.decodeEffect(
    Schema.fromJsonString(Schema.Array(ReaderFlags))
  )(source);
});

const newsFixture = (
  items: readonly CafeNewsItemValue[],
  sort: "rank" | "newest"
) => {
  const path = sort === "rank" ? "/news" : "/news/latest";

  return Schema.decodeSync(ReaderFlags)({
    bibliography: [],
    blocks: [],
    cafe: CafeModel.News({
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

const headTags = (document: Document) =>
  [
    ...document.head.querySelectorAll(
      'title, meta[name="description"], meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"], script[type="application/ld+json"], link[rel="stylesheet"]'
    ),
  ].map((tag) => tag.outerHTML);

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
};

const foldkit = (flags: typeof ReaderFlags.Type) =>
  renderToString(
    { Flags: ReaderFlags, init, view },
    { flags, isHydratable: false }
  );

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

it.live.prop(
  "generated news preserves row order, visible text and the inert handoff",
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
        Option.filter(CafeModel.guards.News),
        Effect.fromOption
      );

      const reference = yield* foldkit(flags);
      const application = yield* renderNewsPage(flags, cafe, newsAssets);

      const output = renderDocument(withReaderHead(application, flags), {
        ...newsAssets,
        stylesheets: [],
      });

      const expected = parseMarkup(reference.html);
      const actual = parseMarkup(output);

      expect(rowText(actual)).toEqual(rowText(expected));
      expect(rowText(actual)).toHaveLength(items.length);
      expect(visibleText(actual)).toEqual(visibleText(expected));
      expect(linksAndStyles(actual)).toEqual(linksAndStyles(expected));
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
  test.effect("the news HTML matches Foldkit and adopts its server DOM", () =>
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
          Option.fromNullishOr(pages.find((entry) => entry.page.path === path))
        );

        const cafe = yield* page.cafe.pipe(
          Option.filter(CafeModel.guards.News),
          Effect.fromOption
        );

        const legacy = yield* foldkit(page);

        const foldkitDocument = parseMarkup(
          renderDocument(withReaderHead(legacy, page), {
            ...newsAssets,
            stylesheets: stylesheets(home),
          })
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

        expect(headTags(pilotDocument)).toEqual(headTags(foldkitDocument));
        expect(
          pilotDocument.querySelectorAll(
            "title, link[rel=canonical], meta[name=description]"
          )
        ).toHaveLength(3);
        expect(
          pilotDocument.querySelectorAll("head script, head style")
        ).toHaveLength(
          foldkitDocument.querySelectorAll("head script, head style").length + 1
        );

        expect(pilotDocument.querySelector(`#${newsRootId} ol`)).not.toBeNull();
        expect(
          pilotDocument.querySelector(`script#${newsHandoffId}`)
        ).not.toBeNull();
        expect(
          pilotDocument.querySelector(
            "[data-foldkit-app], [data-foldkit-flags]"
          )
        ).toBeNull();

        const expectedRows = rowText(foldkitDocument);
        expect(expectedRows.length).toBeGreaterThan(0);
        expect(rowText(pilotDocument), page.page.path).toEqual(expectedRows);
        expect(visibleText(pilotDocument), page.page.path).toEqual(
          visibleText(foldkitDocument)
        );
        expect(linksAndStyles(pilotDocument), page.page.path).toEqual(
          linksAndStyles(foldkitDocument)
        );

        const hydrated = yield* ssr(NewsPage, cafe);
        expect(hydrated.adopted).toEqual(["/NewsPage"]);
        expect(
          [...hydrated.container.querySelectorAll("ol > li")].map(
            textWithoutWhitespace
          )
        ).toEqual(expectedRows);
      }
    }).pipe(Effect.provide(NodeServices.layer))
  );
});
