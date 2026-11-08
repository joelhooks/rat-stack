import { it } from "@effect/vitest";
import { IsoDate } from "@rat-stack/core/contracts";
import { Option, Schema } from "effect";
import { click, expect, given, role, scene, selector } from "foldkit/scene";

import { embedUrl, thumbnailUrl, watchUrl } from "../src/client/tube/data.js";
import type { TubeModel } from "../src/client/tube/model.js";
import { update } from "../src/client/tube/update.js";
import { view } from "../src/features/tube/index.js";

const id = "SxdOUGdseq4";

const title = "Simple Made Easy";

const model: TubeModel = {
  playing: Option.none(),
  videos: [
    {
      channel: "Strange Loop Conference",
      channelUrl: "https://www.youtube.com/@StrangeLoopConf",
      checked: Schema.decodeSync(IsoDate)("2026-11-08"),
      durationSeconds: 3699,
      id,
      published: Schema.decodeSync(IsoDate)("2021-09-02"),
      take: "Simple is not easy.",
      theme: "systems",
      tier: "A",
      title,
      url: watchUrl(id),
    },
  ],
};

it("a card links to YouTube and loads no player until the reader presses play", () => {
  scene(
    { update, view },
    given(model),
    expect(selector("iframe")).toBeAbsent(),
    expect(role("link", { name: title })).toHaveAttr("href", watchUrl(id)),
    expect(role("img", { name: `Video thumbnail for ${title}` })).toHaveAttr(
      "src",
      thumbnailUrl(id)
    ),
    expect(role("img", { name: `Video thumbnail for ${title}` })).toHaveAttr(
      "loading",
      "lazy"
    ),
    expect(role("img", { name: `Video thumbnail for ${title}` })).toHaveAttr(
      "referrerpolicy",
      "no-referrer"
    ),
    click(role("button", { name: `Play here: ${title}` })),
    expect(selector("iframe")).toHaveAttr("src", embedUrl(id)),
    expect(role("button", { name: `Play here: ${title}` })).toBeAbsent(),
    expect(role("link", { name: title })).toHaveAttr("href", watchUrl(id))
  );
});
