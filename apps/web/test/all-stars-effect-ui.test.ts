import { NodeServices } from "@effect/platform-node";
import { ssr } from "@effect/ui/html/testing";
import { TestHost } from "@effect/ui/testing";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Option, Path, Schema } from "effect";

import { AllStarsPage } from "../src/client/all-stars-effect-ui/component.js";
import {
  AllStarsHandoff,
  AllStarsProps,
  allStarsHandoffId,
  allStarsRootId,
} from "../src/client/all-stars-effect-ui/model.js";
import { CafePage, ReaderSource } from "../src/reader-cafe.js";
import { renderAllStarsPage } from "../src/server/all-stars-effect-ui.js";
import {
  renderDocument,
  withReaderHead,
} from "../src/server/reader-document.js";
import { cafeParity, parseCafeHtml } from "./cafe-parity.js";
import fixture from "./fixtures/foldkit-all-stars-parity.json";

const cardSelector = "main ul > li:has(img)";

const assets = {
  entryScript: "/assets/all-stars-effect-ui-test.js",
  modulePreloads: [],
  stylesheets: [],
};

const allStarsFlags = Effect.gen(function* allStarsFlags() {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;

  const source = yield* fs.readFileString(
    paths.resolve(import.meta.dirname, "../dist/reader-pages.json")
  );

  const pages = yield* Schema.decodeEffect(
    Schema.fromJsonString(Schema.Array(ReaderSource))
  )(source);

  const flags = yield* Effect.fromOption(
    Option.fromNullishOr(pages.find((page) => page.page.path === "/all-stars"))
  );

  const cafe = yield* Effect.fromOption(
    flags.cafe.pipe(Option.filter(CafePage.guards.AllStars))
  );

  return { cafe, flags };
});

it.live(
  "All Stars keeps the captured Foldkit text, links, avatars and classes",
  () =>
    Effect.gen(function* allStarsParity() {
      const { flags } = yield* allStarsFlags;

      const props = yield* Schema.decodeUnknownEffect(AllStarsProps)({
        people: fixture.people,
      });

      const rendered = yield* renderAllStarsPage(flags, props, assets);
      const html = renderDocument(withReaderHead(rendered, flags), assets);

      expect(cafeParity(parseCafeHtml(html), cardSelector)).toEqual(
        fixture.legacy
      );
    }).pipe(Effect.provide(NodeServices.layer))
);

it.layer(TestHost.layer())("All Stars with committed data", (test) => {
  test.effect(
    "the built route preserves profile order and adopts its keyed cards",
    () =>
      Effect.gen(function* committedAllStars() {
        const { cafe } = yield* allStarsFlags;
        const fs = yield* FileSystem.FileSystem;
        const paths = yield* Path.Path;

        const output = parseCafeHtml(
          yield* fs.readFileString(
            paths.resolve(
              import.meta.dirname,
              "../dist/client/all-stars/index.html"
            )
          )
        );

        const ordered = [
          ...cafe.people.filter(({ kind }) => kind === "person"),
          ...cafe.people.filter(({ kind }) => kind === "channel"),
        ];

        const expected = ordered.map(({ avatar, name, route }) => ({
          avatar,
          name,
          route,
        }));

        const cards = [...output.querySelectorAll(cardSelector)].map(
          (card) => ({
            avatar: card.querySelector("img")?.getAttribute("src"),
            name: card.querySelector("h3 a")?.textContent,
            route: card.querySelector("h3 a")?.getAttribute("href"),
          })
        );

        expect(cards).toEqual(expected);
        expect(cards.length).toBeGreaterThan(0);
        expect(
          output.querySelector('script[type="module"]')?.getAttribute("src")
        ).toMatch(/^\/assets\/all-stars-effect-ui-[\w-]+\.js$/u);
        expect(
          output.querySelector("[data-foldkit-app], [data-foldkit-flags]")
        ).toBeNull();
        expect(output.querySelector(`#${allStarsRootId}`)).not.toBeNull();

        const payload = output.querySelector(`#${allStarsHandoffId}`);
        expect(payload?.getAttribute("type")).toBe("application/json");

        const { props } = yield* Schema.decodeEffect(
          Schema.fromJsonString(AllStarsHandoff)
        )(payload?.textContent ?? "");

        expect(props).toEqual({ people: cafe.people });

        const hydrated = yield* ssr(AllStarsPage, props);
        expect(hydrated.adopted).toEqual(["/AllStarsPage"]);
        expect(
          [...hydrated.container.querySelectorAll("li:has(img) h3 a")].map(
            (link) => link.getAttribute("href")
          )
        ).toEqual(ordered.map(({ route }) => route));
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
