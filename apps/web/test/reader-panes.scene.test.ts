import { it } from "@effect/vitest";
import { Option } from "effect";
import {
  Command,
  Subscription,
  click,
  expect,
  given,
  role,
  scene,
  within,
} from "foldkit/scene";

import { ReaderNode } from "../src/client/reader-node.js";
import {
  ClosePhoneOutline,
  RevealOutlineRow,
} from "../src/client/reader/command.js";
import { Message } from "../src/client/reader/message.js";
import { Disclosure } from "../src/client/reader/model.js";
import { update } from "../src/client/reader/update.js";
import { view } from "../src/features/reader.js";
import { readerModelFixture } from "./reader-fixture.js";

const heading = (tag: "h2" | "h3", id: string, text: string) =>
  ReaderNode.Element({
    attributes: [{ name: "id", value: id }],
    children: [ReaderNode.Text({ value: text })],
    tag,
  });

const fencePage = {
  ...readerModelFixture,
  bodyNodes: Option.some([
    heading("h2", "what-it-does", "What it does"),
    heading("h3", "lint", "Lint"),
    heading("h2", "how-to-check", "How to check"),
  ]),
  page: { ...readerModelFixture.page, path: "/systems/fence" },
  sectionIndex: Option.some({
    href: "/systems",
    pages: [
      { path: "/systems", title: "Rat Stack systems" },
      { path: "/systems/auth", title: "Auth" },
      { path: "/systems/fence", title: "Fence" },
    ],
    title: "Rat Stack systems",
  }),
};

const sectionPages = role("navigation", { name: "Section pages" });

const onThisPage = role("navigation", { name: "On this page" });

const siteMenu = role("navigation", { name: "Site menu" });

const phoneOutline = within(role("main"), role("group"));

it("the section index marks the current page and the outline lists the page headings", () => {
  scene(
    { update, view },
    given(fencePage),
    expect(within(sectionPages, role("link", { name: "Fence" }))).toHaveAttr(
      "aria-current",
      "page"
    ),
    expect(within(sectionPages, role("link", { name: "Auth" }))).not.toHaveAttr(
      "aria-current",
      "page"
    ),
    expect(within(onThisPage, role("link", { name: "Lint" }))).toHaveAttr(
      "href",
      "#lint"
    ),
    expect(
      within(onThisPage, role("link", { name: "How to check" }))
    ).not.toHaveAttr("aria-current", "location")
  );
});

it("every heading in the visible range is marked, an h3 with its h2", () => {
  scene(
    { update, view },
    given(fencePage),
    Subscription.emit(
      Message.ScrolledOutline({
        range: { current: "lint", ids: ["what-it-does", "lint"] },
      })
    ),
    Command.expectExact(RevealOutlineRow({ id: "lint" })),
    Command.resolve(RevealOutlineRow, Message.CompletedRevealOutlineRow()),
    expect(
      within(onThisPage, role("link", { name: "What it does" }))
    ).toHaveAttr("aria-current", "location"),
    expect(within(onThisPage, role("link", { name: "Lint" }))).toHaveAttr(
      "aria-current",
      "location"
    ),
    expect(
      within(onThisPage, role("link", { name: "How to check" }))
    ).not.toHaveAttr("aria-current", "location")
  );
});

it("the outline nests each h3 under its h2", () => {
  scene(
    { update, view },
    given(fencePage),
    expect(
      within(
        within(onThisPage, role("listitem", { name: /What it does/u })),
        role("link", { name: "Lint" })
      )
    ).toExist(),
    expect(
      within(
        within(onThisPage, role("listitem", { name: /How to check/u })),
        role("link", { name: "Lint" })
      )
    ).not.toExist()
  );
});

it("the phone outline is a native disclosure the view never controls, closed after a jump", () => {
  scene(
    { update, view },
    given(fencePage),
    expect(phoneOutline).not.toHaveAttr("open"),
    click(within(phoneOutline, role("link", { name: "How to check" }))),
    Command.expectExact(ClosePhoneOutline()),
    Command.resolve(ClosePhoneOutline, Message.CompletedClosePhoneOutline()),
    expect(phoneOutline).not.toHaveAttr("open")
  );
});

it("the phone menu lists the section's pages with the current one marked", () => {
  scene(
    { update, view },
    given({ ...fencePage, menu: Disclosure.Closed() }),
    click(role("button", { name: "Menu" })),
    expect(within(siteMenu, role("link", { name: "Fence" }))).toHaveAttr(
      "aria-current",
      "page"
    ),
    expect(within(siteMenu, role("link", { name: "Auth" }))).toBeVisible()
  );
});

it("a page outside any section falls back to the site sections", () => {
  scene(
    { update, view },
    given(readerModelFixture),
    expect(within(sectionPages, role("link", { name: "systems" }))).toExist()
  );
});
