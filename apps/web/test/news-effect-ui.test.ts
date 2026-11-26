import { NodeServices } from "@effect/platform-node";
import { HtmlLocator, HtmlScene, ssr } from "@effect/ui/html/testing";
import { Locator, Story, TestHost } from "@effect/ui/testing";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { Model as CafeModel } from "../src/client/cafe/model.js";
import { NewsPage } from "../src/client/news-effect-ui/component.js";
import {
  newsHandoffId,
  newsRootId,
} from "../src/client/news-effect-ui/model.js";
import { init } from "../src/client/reader/init.js";
import { ReaderFlags } from "../src/client/reader/model.js";
import { view } from "../src/features/reader.js";

const latestLink = HtmlLocator.role("link", { name: "Latest first" });

const rankLink = HtmlLocator.role("link", { name: "Ranked by interest" });

const sortHeading = Locator.text("How this list is sorted");

it.effect("the story starts in the requested order", () =>
  Effect.gen(function* requestedOrder() {
    const latest = yield* Story.make(NewsPage, {
      items: [],
      profiles: [],
      sort: "newest",
    });

    const rank = yield* Story.make(NewsPage, {
      items: [],
      profiles: [],
      sort: "rank",
    });

    expect(latest.model).toBe("newest");
    expect(rank.model).toBe("rank");
  })
);

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
  [...document.querySelectorAll("a, [class]")].map((element) => [
    element.localName,
    element.getAttribute("href"),
    element.getAttribute("rel"),
    element.getAttribute("aria-label"),
    element.getAttribute("class"),
  ]);

it.layer(TestHost.layer())("news with committed data", (test) => {
  test.effect("the news HTML matches Foldkit and adopts its server DOM", () =>
    Effect.gen(function* renderCommittedNews() {
      const fs = yield* FileSystem.FileSystem;
      const paths = yield* Path.Path;

      const source = yield* fs.readFileString(
        paths.resolve(import.meta.dirname, "../dist/reader-pages.json")
      );

      const pages = yield* Schema.decodeEffect(
        Schema.fromJsonString(Schema.Array(ReaderFlags))
      )(source);

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

        const legacy = yield* renderToString(
          { Flags: ReaderFlags, init, view },
          { flags: page, isHydratable: false }
        );

        const foldkitDocument = parseMarkup(legacy.html);
        const pilotDocument = parseMarkup(html);

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
