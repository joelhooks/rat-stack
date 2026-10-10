import { it } from "@effect/vitest";
import { Option } from "effect";
import {
  Command,
  Subscription,
  click,
  expect,
  given,
  keydown,
  role,
  scene,
  text,
  type,
} from "foldkit/scene";
import { fromString } from "foldkit/url";

import { ReplaceUrl, SearchDocs } from "../src/client/docs/command.js";
import { Message } from "../src/client/docs/message.js";
import { Message as ReaderMessage } from "../src/client/reader/message.js";
import { update as readerUpdate } from "../src/client/reader/update.js";
import { update, view } from "../src/features/app.js";
import { view as readerView } from "../src/features/reader.js";
import { docsHome, docsResult, searchPage } from "./docs-fixture.js";

const searchBox = role("textbox", { name: "Search the docs" });

const searchButton = role("button", { name: "Search" });

const arrivedAt = (path: string) =>
  ReaderMessage.GotDocsMessage({
    message: Message.ChangedUrl({
      url: Option.getOrThrow(fromString(`https://ratstack.sh${path}`)),
    }),
  });

it("accessible search controls hide old results during loading and retain the latest result after a stale failure", () => {
  scene(
    { update, view },
    given(docsHome),
    type(searchBox, "first query"),
    click(searchButton),
    Command.resolve(ReplaceUrl, Message.CompletedNavigate()),
    Command.resolve(
      SearchDocs,
      Message.SucceededSearch({
        generation: 1,
        result: docsResult("Older result"),
      })
    ),
    expect(role("link", { name: "Older result" })).toExist(),
    type(searchBox, "second query"),
    click(searchButton),
    Command.resolve(ReplaceUrl, Message.CompletedNavigate()),
    expect(text("Searching the docs…")).toExist(),
    expect(role("link", { name: "Older result" })).toBeAbsent(),
    Command.resolve(
      SearchDocs,
      Message.SucceededSearch({
        generation: 2,
        result: docsResult("Latest result"),
      })
    ),
    Subscription.emit(Message.FailedSearch({ generation: 1 })),
    expect(role("alert")).toBeAbsent(),
    expect(role("link", { name: "Latest result" })).toExist(),
    expect(role("link", { name: "Older result" })).toBeAbsent(),
    Command.expectNone()
  );
});

it("the /search page preloads ?q=, searches again on Enter, puts the query in the URL, and links each match to its page", () => {
  scene(
    { update: readerUpdate, view: readerView },
    given(searchPage),
    expect(role("link", { name: "search" })).toHaveAttr("href", "/search"),
    expect(role("heading", { name: "Search the docs" })).toExist(),
    expect(text("Matches appear here.")).toExist(),
    Subscription.emit(arrivedAt("/search?q=cartridge")),
    Command.expectExact(SearchDocs({ generation: 1, query: "cartridge" })),
    expect(searchBox).toHaveValue("cartridge"),
    expect(text("Searching the docs…")).toExist(),
    Command.resolve(
      SearchDocs,
      Message.SucceededSearch({
        generation: 1,
        result: docsResult("cartridges"),
      })
    ),
    expect(text("1 result")).toExist(),
    expect(role("link", { name: "cartridges" })).toHaveAttr(
      "href",
      "/lore/cartridges"
    ),
    type(searchBox, " capability "),
    keydown(searchBox, "Enter"),
    Command.expectExact(
      SearchDocs({ generation: 2, query: "capability" }),
      ReplaceUrl({ url: "/search?q=capability" })
    ),
    Command.resolve(ReplaceUrl, Message.CompletedNavigate()),
    Command.resolve(
      SearchDocs,
      Message.SucceededSearch({
        generation: 2,
        result: docsResult("one-capability-every-surface"),
      })
    ),
    expect(role("link", { name: "one-capability-every-surface" })).toHaveAttr(
      "href",
      "/lore/one-capability-every-surface"
    ),
    Command.expectNone()
  );
});

it("on /search, a stale search result that lands after a newer query is ignored", () => {
  scene(
    { update: readerUpdate, view: readerView },
    given(searchPage),
    type(searchBox, "older"),
    click(searchButton),
    Command.resolve(ReplaceUrl, Message.CompletedNavigate()),
    Command.resolve(
      SearchDocs,
      Message.SucceededSearch({
        generation: 1,
        result: docsResult("Older result"),
      })
    ),
    type(searchBox, "newer"),
    click(searchButton),
    Command.resolve(ReplaceUrl, Message.CompletedNavigate()),
    Command.resolve(
      SearchDocs,
      Message.SucceededSearch({
        generation: 2,
        result: docsResult("Newer result"),
      })
    ),
    Subscription.emit(
      ReaderMessage.GotDocsMessage({
        message: Message.SucceededSearch({
          generation: 1,
          result: docsResult("Older result"),
        }),
      })
    ),
    expect(role("link", { name: "Newer result" })).toExist(),
    expect(role("link", { name: "Older result" })).toBeAbsent(),
    expect(searchBox).toHaveValue("newer"),
    Command.expectNone()
  );
});
