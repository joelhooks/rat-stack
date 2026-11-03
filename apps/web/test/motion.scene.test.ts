import { it } from "@effect/vitest";
import { easingNames } from "@rat-stack/motion";
import { click, expect, given, role, scene } from "foldkit/scene";

import { initialModel } from "../src/client/motion/model.js";
import { update } from "../src/client/motion/update.js";
import { view } from "../src/features/motion/index.js";

it("the gallery plots every easing by name", () => {
  scene(
    { update, view },
    given(initialModel),
    ...easingNames.map((name) =>
      expect(role("img", { name: `${name} easing curve` })).toExist()
    ),
    expect(role("button", { name: "Replay curves" })).toExist()
  );
});

it("choosing a target presses its button and releases the previous one", () => {
  scene(
    { update, view },
    given(initialModel),
    expect(role("button", { name: "centre" })).toHaveAttr(
      "aria-pressed",
      "true"
    ),
    click(role("button", { name: "top left" })),
    expect(role("button", { name: "top left" })).toHaveAttr(
      "aria-pressed",
      "true"
    ),
    expect(role("button", { name: "centre" })).toHaveAttr(
      "aria-pressed",
      "false"
    ),
    expect(
      role("img", {
        name: "Spring dot and tween dot moving toward the chosen target",
      })
    ).toExist()
  );
});
