import { it } from "@effect/vitest";
import { click, expect, given, label, role, scene, text } from "foldkit/scene";

import { update } from "../src/client/cafe/update.js";
import { view } from "../src/features/cafe/index.js";
import { directoryHome } from "./cafe-fixture.js";

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
