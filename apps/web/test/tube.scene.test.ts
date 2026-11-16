import { it } from "@effect/vitest";
import { IsoDate } from "@rat-stack/core/contracts";
import { Option, Schema } from "effect";
import { click, expect, given, role, scene, selector } from "foldkit/scene";

import {
  TubePage,
  embedUrl,
  thumbnailUrl,
  watchUrl,
} from "../src/client/tube/data.js";
import type { TubeModel } from "../src/client/tube/model.js";
import { update } from "../src/client/tube/update.js";
import { view } from "../src/features/tube/index.js";

const id = "SxdOUGdseq4";

const title = "Simple Made Easy";

const model: TubeModel = {
  playing: Option.none(),
  selected: Option.none(),
  videos: [
    {
      basis: "transcript",
      channel: "Strange Loop Conference",
      channelUrl: "https://www.youtube.com/@StrangeLoopConf",
      checked: Schema.decodeSync(IsoDate)("2026-11-08"),
      durationSeconds: 3699,
      id,
      slug: "simple-made-easy",
      published: Schema.decodeSync(IsoDate)("2021-09-02"),
      take: "Simple is not easy.",
      theme: "systems",
      tier: "A",
      title,
      url: watchUrl(id),
    },
  ],
};

it("a video page keeps summary and concepts while play loads the existing nocookie embed", () => {
  const page = Schema.decodeSync(TubePage)({
    basis: "transcript",
    concepts: [{ term: "Simple", route: "/lore/a-clean-playground" }],
    gaps: [],
    sections: [{ at: 98, note: "The speaker distinguishes simple and easy." }],
    summary: [
      "Simple concerns how many things are intertwined.",
      "Easy concerns what is familiar or close at hand.",
    ],
    written: "2026-11-15",
  });

  scene(
    { update, view },
    given({
      ...model,
      selected: Option.some(id),
      videos: model.videos.map((video) => ({ ...video, page })),
    }),
    expect(selector("iframe")).toBeAbsent(),
    expect(role("link", { name: "1:38" })).toHaveAttr(
      "href",
      `${watchUrl(id)}&t=98s`
    ),
    click(role("button", { name: `Play here: ${title}` })),
    expect(selector("iframe")).toHaveAttr("src", embedUrl(id)),
    expect(role("heading", { name: "Summary" })).toExist(),
    expect(role("heading", { name: "Key concepts" })).toExist()
  );
});

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
