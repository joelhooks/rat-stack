import { expect, it } from "@effect/vitest";
import { IsoDate } from "@rat-stack/core/contracts";
import { Option, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { watchUrl, YoutubeVideoId } from "../src/client/tube/data.js";
import { Message } from "../src/client/tube/message.js";
import type { TubeModel } from "../src/client/tube/model.js";
import { update } from "../src/client/tube/update.js";

const listed = ["PxIBWjiv3og", "SxdOUGdseq4", "k4UXEfZf3sc"] as const;

const model: TubeModel = {
  playing: Option.none(),
  videos: listed.map((id) => ({
    channel: "A channel",
    channelUrl: "https://www.youtube.com/@channel",
    checked: Schema.decodeSync(IsoDate)("2026-11-08"),
    durationSeconds: 60,
    id,
    published: Schema.decodeSync(IsoDate)("2024-01-01"),
    take: "A take.",
    theme: "effect",
    tier: "A",
    title: `Video ${id}`,
    url: watchUrl(id),
  })),
};

const clicks = Arbitrary.array(
  Arbitrary.schema(Schema.Union([Schema.Literals(listed), YoutubeVideoId])),
  { maxLength: 30 }
);

it.prop(
  "the player shows the last listed video the reader pressed play on, and nothing before the first press",
  { history: clicks },
  ({ history }) => {
    let final = model;

    for (const id of history) {
      final = update(final, Message.ClickedPlay({ id })).model;
    }

    const lastListed = history.findLast((id) =>
      listed.some((candidate) => candidate === id)
    );

    expect(final.playing).toEqual(Option.fromNullishOr(lastListed));
    expect(final.videos).toBe(model.videos);
  }
);
