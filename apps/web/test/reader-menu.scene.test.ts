import { it } from "@effect/vitest";
import {
  Subscription,
  click,
  expect,
  given,
  role,
  scene,
  within,
} from "foldkit/scene";

import { Message } from "../src/client/reader/message.js";
import { Menu } from "../src/client/reader/model.js";
import { update } from "../src/client/reader/update.js";
import { view } from "../src/features/reader.js";
import { readerModelFixture } from "./reader-fixture.js";

const onSystemsPage = {
  ...readerModelFixture,
  page: { ...readerModelFixture.page, path: "/systems/fence" },
};

const menuButton = role("button", { name: "Menu" });

const closeButton = role("button", { name: "Close" });

const siteMenu = role("navigation", { name: "Site menu" });

const primaryNavigation = role("navigation", { name: "Primary navigation" });

it("the server render keeps every section link in the toolbar and offers no menu button", () => {
  scene(
    { update, view },
    given(onSystemsPage),
    expect(menuButton).not.toExist(),
    expect(siteMenu).not.toExist(),
    expect(
      within(primaryNavigation, role("link", { name: "systems" }))
    ).toHaveAttr("aria-current", "page"),
    expect(within(primaryNavigation, role("link", { name: "news" }))).toExist()
  );
});

it("the menu opens a sheet with the current section marked, and Escape or Close shuts it", () => {
  scene(
    { update, view },
    given({ ...onSystemsPage, menu: Menu.Closed() }),
    expect(menuButton).toHaveAttr("aria-expanded", "false"),
    expect(siteMenu).not.toBeVisible(),
    click(menuButton),
    expect(closeButton).toHaveAttr("aria-expanded", "true"),
    expect(within(siteMenu, role("link", { name: "systems" }))).toHaveAttr(
      "aria-current",
      "page"
    ),
    expect(
      within(siteMenu, role("link", { name: "agent guide" }))
    ).toBeVisible(),
    Subscription.emit(Message.PressedEscape()),
    expect(siteMenu).not.toBeVisible(),
    expect(menuButton).toExist(),
    click(menuButton),
    click(closeButton),
    expect(siteMenu).not.toBeVisible()
  );
});
