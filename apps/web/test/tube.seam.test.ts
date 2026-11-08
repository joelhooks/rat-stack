import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { readerTubeFlags } from "../../site/scripts/reader-tube-flags.ts";
import { readerWebsiteRoutes } from "../../site/src/reader-website.js";
import { tubePagePath } from "../../site/src/security.js";
import { init } from "../src/client/reader/init.js";
import { ReaderFlags } from "../src/client/reader/model.js";
import { thumbnailUrl, tubeTiers } from "../src/client/tube/data.js";
import { view } from "../src/features/reader.js";
import { tubeRoutePath } from "../src/features/tube/copy.js";
import { isReaderRoutePath } from "../src/reader-routes.js";

const htmlText = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

it.effect("/tube prerenders every ranked video as a link with no player", () =>
  Effect.gen(function* renderTube() {
    expect(isReaderRoutePath(tubeRoutePath)).toBe(true);
    expect(readerWebsiteRoutes).toContain(tubeRoutePath);
    expect(tubePagePath).toBe(tubeRoutePath);

    const flags = yield* Schema.decodeUnknownEffect(ReaderFlags)(
      yield* readerTubeFlags("https://ratstack.sh")
    );

    expect(flags.page.path).toBe(tubeRoutePath);

    const videos = Option.match(flags.tube, {
      onNone: () => [],
      onSome: (tube) => tube.videos,
    });

    expect(videos.length).toBeGreaterThanOrEqual(30);

    expect(videos.map((video) => tubeTiers.indexOf(video.tier))).toEqual(
      videos
        .map((video) => tubeTiers.indexOf(video.tier))
        .toSorted((left, right) => left - right)
    );

    const rendered = yield* renderToString(
      { Flags: ReaderFlags, init, view },
      { flags, isHydratable: false }
    );

    expect(rendered.html).not.toContain("<iframe");

    for (const video of videos) {
      expect(rendered.html).toContain(`href="${htmlText(video.url)}"`);
      expect(rendered.html).toContain(`src="${thumbnailUrl(video.id)}"`);
      expect(rendered.html).toContain(htmlText(video.take));
    }
  }).pipe(Effect.provide(NodeServices.layer))
);
