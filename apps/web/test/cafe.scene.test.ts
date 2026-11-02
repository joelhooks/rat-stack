import { it } from "@effect/vitest";
import { CafePersonSummary, CafeStory } from "@rat-stack/core/contracts";
import { Schema } from "effect";
import { click, expect, given, label, role, scene, text } from "foldkit/scene";

import { Model } from "../src/client/cafe/model.js";
import { update } from "../src/client/cafe/update.js";
import { view } from "../src/features/cafe/index.js";
import { directoryHome, fullStack } from "./cafe-fixture.js";

it("CAFE pages show the short prompt instead of the agent filing instructions", () => {
  for (const model of [
    directoryHome,
    Model.News({ items: [], profiles: [], rankedAt: fullStack.date }),
  ]) {
    scene(
      { update, view },
      given(model),
      expect(
        text("Know a CAFE project or story? Ask your agent to suggest it.")
      ).toExist(),
      expect(text("Suggest a CAFE entry through your agent")).toBeAbsent()
    );
  }
});

it("pressing stack letters narrows the directory to projects with evidence for every pressed letter", () => {
  scene(
    { update, view },
    given(directoryHome),
    expect(text("3 projects")).toExist(),
    expect(role("button", { name: "Show all projects" })).toBeAbsent(),
    click(role("button", { name: "Cloudflare" })),
    expect(role("button", { name: "Cloudflare" })).toHaveAttr(
      "aria-pressed",
      "true"
    ),
    expect(text("2 projects")).toExist(),
    expect(role("link", { name: "effect-only" })).toBeAbsent(),
    expect(role("link", { name: "edge-app" })).toExist(),
    click(role("button", { name: "Foldkit" })),
    expect(text("1 project")).toExist(),
    expect(role("link", { name: "edge-app" })).toBeAbsent(),
    expect(role("link", { name: "full-stack" })).toExist(),
    click(role("button", { name: "Show all projects" })),
    expect(text("3 projects")).toExist(),
    expect(role("button", { name: "Cloudflare" })).toHaveAttr(
      "aria-pressed",
      "false"
    ),
    expect(role("link", { name: "effect-only" })).toExist()
  );
});

it("badges name each verified letter and its evidence", () => {
  scene(
    { update, view },
    given(directoryHome),
    expect(role("link", { name: "effect-only" })).toExist(),
    expect(label("Effect: effect evidence in package.json")).toHaveText("E"),
    expect(label("Foldkit: foldkit evidence in package.json")).toHaveText("F"),
    expect(label("Foldkit: null")).toBeAbsent()
  );
});

const fact = {
  source: "https://github.com/ada",
  text: "Ada builds CAFE things.",
  verified: "2026-11-02",
};

const ada = Schema.decodeSync(CafePersonSummary)({
  avatar: "/avatars/ada.png",
  handles: [
    {
      handle: "ada",
      kind: "github",
      url: "https://github.com/ada",
      ...fact,
    },
  ],
  id: "ada",
  kind: "person",
  name: "Ada",
  packages: [],
  route: "/all-stars/ada",
  summary: fact,
  topics: [],
});

it("the all stars index shows one card per person, and channels under their own heading", () => {
  scene(
    { update, view },
    given(
      Model.AllStars({
        people: [
          ada,
          Schema.decodeSync(CafePersonSummary)({
            ...Schema.encodeSync(CafePersonSummary)(ada),
            id: "fold",
            kind: "channel",
            name: "Fold",
          }),
        ],
      })
    ),
    expect(role("link", { name: "Ada" })).toHaveAttr("href", "/all-stars/ada"),
    expect(role("heading", { name: "People" })).toExist(),
    expect(role("heading", { name: "Channels" })).toExist(),
    expect(role("link", { name: "Fold" })).toExist(),
    expect(text("Ada builds CAFE things.")).toExist(),
    expect(role("link", { name: "open an issue" })).toExist()
  );
});

it("a news row whose author has a profile links to it", () => {
  const row = Schema.decodeSync(CafeStory)({
    author: { github: "ada", x: null },
    date: "2026-11-01",
    kind: "post",
    repo: null,
    source: "https://example.com/source",
    summary: "A row.",
    title: "Ada's row",
    url: "https://example.com/row",
  });

  scene(
    { update, view },
    given(
      Model.News({
        items: [row],
        profiles: [{ name: "Ada", route: "/all-stars/ada", url: row.url }],
        rankedAt: row.date,
      })
    ),
    expect(role("link", { name: "Ada on all stars" })).toHaveAttr(
      "href",
      "/all-stars/ada"
    )
  );
});
