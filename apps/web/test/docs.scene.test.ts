import { it } from "@effect/vitest";
import {
  Command,
  Subscription,
  click,
  expect,
  given,
  role,
  scene,
  text,
  type,
} from "foldkit/scene";

import { SearchDocs } from "../src/client/docs.js";
import { Message } from "../src/client/model.js";
import { update, view } from "../src/features/app.js";
import { docsHome, docsResult } from "./docs-fixture.js";

it("accessible search controls hide old results during loading and retain the latest result after a stale failure", () => {
  scene(
    { update, view },
    given(docsHome),
    type(role("textbox", { name: "Search the docs" }), "first query"),
    click(role("button", { name: "Search" })),
    Command.resolve(
      SearchDocs,
      Message.SucceededSearch({
        generation: 1,
        result: docsResult("Older result"),
      })
    ),
    expect(role("link", { name: "Older result" })).toExist(),
    type(role("textbox", { name: "Search the docs" }), "second query"),
    click(role("button", { name: "Search" })),
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
