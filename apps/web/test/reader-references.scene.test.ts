import { it } from "@effect/vitest";
import { Option } from "effect";
import { click, expect, given, role, scene, text, within } from "foldkit/scene";

import { Disclosure } from "../src/client/reader/model.js";
import { update } from "../src/client/reader/update.js";
import { view } from "../src/features/reader.js";
import { readerModelFixture } from "./reader-fixture.js";

const headline = "mutant-cafe 0.1.2: mutation testing for Effect TypeScript";

const withNews = { ...readerModelFixture, newsTitle: Option.some(headline) };

const primaryNavigation = role("navigation", { name: "Primary navigation" });

const siteMenu = role("navigation", { name: "Site menu" });

const referencedBy = role("region", { name: "Referenced by 2" });

it("the news link carries the latest headline in the toolbar and leaves the page body", () => {
  scene(
    { update, view },
    given(withNews),
    expect(
      within(primaryNavigation, role("link", { name: "news" }))
    ).toHaveAttr("aria-describedby", "news-latest"),
    expect(within(primaryNavigation, role("tooltip"))).toHaveText(
      `Latest news ${headline}`
    ),
    expect(within(role("main"), text(headline))).not.toExist()
  );
});

it("the phone menu shows the latest headline under news", () => {
  scene(
    { update, view },
    given({ ...withNews, menu: Disclosure.Closed() }),
    click(role("button", { name: "Menu" })),
    expect(within(siteMenu, text(headline))).toBeVisible()
  );
});

it("without a headline the news link is a plain section link", () => {
  scene(
    { update, view },
    given(readerModelFixture),
    expect(
      within(primaryNavigation, role("link", { name: "news" }))
    ).not.toHaveAttr("aria-describedby", "news-latest"),
    expect(within(primaryNavigation, role("tooltip"))).not.toExist()
  );
});

it("pages that link here become Referenced by cards citing the linking sentence", () => {
  scene(
    { update, view },
    given({
      ...readerModelFixture,
      references: Option.some({
        anchors: [],
        backlinks: [
          {
            context: "The fence rejects floating Effects.",
            description: "Compiler checks and hooks.",
            route: "/systems/fence",
            title: "Fence",
          },
          {
            context: "",
            description: "Typed failures at the boundary.",
            route: "/lore/error-model",
            title: "Error model",
          },
        ],
        inboundCounts: {},
      }),
    }),
    expect(referencedBy).toExist(),
    expect(within(referencedBy, role("link", { name: /Fence/u }))).toHaveText(
      "/systems/fence Fence The fence rejects floating Effects."
    ),
    expect(
      within(referencedBy, role("link", { name: /Error model/u }))
    ).toHaveText(
      "/lore/error-model Error model Typed failures at the boundary."
    )
  );
});
