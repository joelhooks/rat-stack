import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, FileSystem, Option, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { fenceMessage } from "../../../packages/core/test/fixtures/fence-message.js";
import { readerTubePagesFlags } from "../../site/scripts/reader-tube-flags.ts";
import {
  decodeTubeData,
  tubeConceptProblems,
  tubeDataProblems,
  tubeGaps,
  TubeFile,
} from "../../site/scripts/tube-pages.ts";
import { transcriptChunks } from "../../site/scripts/tube-transcript.ts";
import { isReaderWebsiteRoute } from "../../site/src/reader-website.js";
import {
  readerPagePolicy,
  tubeContentSecurityPolicy,
} from "../../site/src/security.js";
import { init } from "../src/client/reader/init.js";
import { ReaderFlags } from "../src/client/reader/model.js";
import {
  TubePage,
  YoutubeVideoId,
  tubePageVideos,
  videoPagePath,
  videoObject,
  watchUrl,
} from "../src/client/tube/data.js";
import { view } from "../src/features/reader.js";
import { isReaderRoutePath } from "../src/reader-routes.js";
import {
  renderDocument,
  withReaderHead,
} from "../src/server/reader-document.js";

const page = Schema.decodeSync(TubePage)({
  basis: "transcript",
  concepts: [{ term: "Effect", route: "/lore/effect-basics" }],
  gaps: ["A missing concept"],
  sections: [{ at: 10, note: "The speaker introduces deferred work." }],
  summary: [
    "The speaker describes deferred work.",
    "The example combines two programs.",
  ],
  written: "2026-11-15",
});

const input = (id: string, durationSeconds = 60, withPage = true) => {
  const base = {
    basis: "transcript",
    channel: "Example",
    channelUrl: "https://www.youtube.com/@example",
    checked: "2026-11-15",
    durationSeconds,
    id,
    published: "2025-01-01",
    take: "An example of composing work.",
    theme: "effect",
    tier: "A",
    title: `Talk ${id}`,
    url: watchUrl(id),
  };

  return withPage ? { ...base, page } : base;
};

it.effect.prop(
  "only summarized videos receive unique, stable page routes independent of ranking and file order",
  {
    entries: Arbitrary.array(
      Arbitrary.all({
        id: Arbitrary.schema(YoutubeVideoId),
        withPage: Arbitrary.schema(Schema.Boolean),
      }),
      { maxLength: 20 }
    ),
  },
  ({ entries }) =>
    Effect.gen(function* stableRoutes() {
      const unique = entries.filter(
        (entry, index) =>
          entries.findIndex((other) => entry.id === other.id) === index
      );

      const videos = unique.map(({ id, withPage }) => input(id, 60, withPage));
      const data = yield* decodeTubeData(JSON.stringify({ videos }));

      const routes = tubePageVideos(data).map((video) =>
        videoPagePath(video.id)
      );

      expect(routes).toEqual(
        unique
          .filter((entry) => entry.withPage)
          .map((entry) => `/tube/${entry.id}`)
      );
      expect(new Set(routes).size).toBe(routes.length);

      const reordered = yield* decodeTubeData(
        JSON.stringify({ videos: videos.toReversed() })
      );

      expect(
        tubePageVideos(reordered)
          .map((video) => videoPagePath(video.id))
          .toSorted()
      ).toEqual(routes.toSorted());

      for (const route of routes) {
        expect(isReaderRoutePath(route)).toBe(true);
        expect(isReaderWebsiteRoute(route)).toBe(true);
        expect(readerPagePolicy(route)).toBe(readerPagePolicy("/tube"));
      }
    })
);

it.prop(
  "empty and missing summaries cannot produce a page, while omission of the page stays valid",
  { id: YoutubeVideoId },
  ({ id }) => {
    for (const summary of [undefined, [], [""], ["Only one paragraph."]]) {
      expect(
        tubeDataProblems(
          Schema.decodeSync(Schema.fromJsonString(TubeFile))(
            JSON.stringify({
              videos: [{ ...input(id), page: { ...page, summary } }],
            })
          )
        ).length
      ).toBeGreaterThan(0);
    }

    expect(tubeDataProblems({ videos: [input(id, 60, false)] })).toEqual([]);
    expect(tubeDataProblems({ videos: [input(id), input(id)] })).toHaveLength(
      1
    );
  }
);

it.effect.prop(
  "every concept resolves exactly, including glossary fragments, and errors accumulate across videos",
  { id: YoutubeVideoId },
  ({ id }) =>
    Effect.gen(function* conceptsResolve() {
      const videos = [
        input(id),
        {
          ...input("ABCDEFGHIJK"),
          page: {
            ...page,
            concepts: [{ term: "Missing", route: "/glossary#missing" }],
          },
        },
      ];

      if (id === "ABCDEFGHIJK") {
        return;
      }

      const data = yield* decodeTubeData(JSON.stringify({ videos }));
      expect(
        tubeConceptProblems(
          data,
          new Set(["/lore/effect-basics", "/glossary#missing"])
        )
      ).toEqual([]);
      const problems = tubeConceptProblems(data, new Set(["/glossary"]));
      expect(problems).toHaveLength(2);

      for (const problem of problems) {
        expect(fenceMessage(problem)).toBeDefined();
      }

      expect(tubeGaps(data).gaps).toEqual([
        {
          term: "A missing concept",
          videos: [`/tube/${id}`, "/tube/ABCDEFGHIJK"],
        },
      ]);
    })
);

it.effect.prop(
  "VideoObject duration preserves the exact recorded seconds",
  {
    id: YoutubeVideoId,
    seconds: Schema.Int.check(
      Schema.isBetween({ minimum: 11, maximum: 86_400 })
    ),
  },
  ({ id, seconds }) =>
    Effect.gen(function* durationMatches() {
      const data = yield* decodeTubeData(
        JSON.stringify({ videos: [input(id, seconds)] })
      );

      const [video] = data.videos;
      expect(video).toBeDefined();

      if (video !== undefined) {
        const object = videoObject(video);

        const match =
          /^PT(?:(?<hours>\d+)H)?(?:(?<minutes>\d+)M)?(?:(?<seconds>\d+)S)?$/u.exec(
            object.duration
          );

        expect(match).not.toBeNull();
        expect(
          Number(match?.groups?.hours ?? 0) * 3600 +
            Number(match?.groups?.minutes ?? 0) * 60 +
            Number(match?.groups?.seconds ?? 0)
        ).toBe(seconds);
      }
    })
);

it("caption digest removes rolling duplicates and retains timestamps", () => {
  expect(
    transcriptChunks(
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello world\n\n00:00:02.000 --> 00:00:03.000\nHello world again\n\n00:01:02.000 --> 00:01:03.000\n<c>Next</c> &amp; last\n"
    )
  ).toEqual([
    { at: 1, text: "Hello world again" },
    { at: 62, text: "Next & last" },
  ]);
});

it("only exact YouTube-id page paths inherit the Tube policy and forwarding", () => {
  expect(readerPagePolicy("/tube/PxIBWjiv3og")).toBe(tubeContentSecurityPolicy);

  for (const route of [
    "/tube/no",
    "/tube/gaps.json",
    "/tube/PxIBWjiv3og/extra",
    "/tube/PxIBWjiv3og/",
    "/tube/",
  ]) {
    expect(isReaderWebsiteRoute(route)).toBe(false);
    expect(readerPagePolicy(route)).toBe(readerPagePolicy("/"));
  }
});

it.effect(
  "a generated video page carries canonical, VideoObject, summary, concepts and the existing click-to-play player",
  () =>
    Effect.gen(function* pageSeam() {
      const pages = yield* readerTubePagesFlags("https://ratstack.sh");

      const encoded = pages.find(
        (entry) => entry.page.path === "/tube/PxIBWjiv3og"
      );

      expect(encoded).toBeDefined();

      if (encoded === undefined) {
        return;
      }

      const flags = yield* Schema.decodeUnknownEffect(ReaderFlags)(encoded);
      const video = Option.getOrUndefined(flags.tube)?.videos[0];
      expect(video?.page).toBeDefined();

      if (video === undefined || video.page === undefined) {
        return;
      }

      const application = yield* renderToString(
        { Flags: ReaderFlags, init, view },
        { flags, isHydratable: false }
      );

      const document = renderDocument(withReaderHead(application, flags), {
        entryScript: "/assets/reader.js",
        modulePreloads: [],
        stylesheets: [],
      });

      expect(document).toContain(
        'rel="canonical" href="https://ratstack.sh/tube/PxIBWjiv3og"'
      );
      expect(document).toContain('"@type":"VideoObject"');
      expect(document).toContain(`"duration":"PT${video.durationSeconds}S"`);
      expect(document).toContain(
        'src="https://i.ytimg.com/vi/PxIBWjiv3og/mqdefault.jpg"'
      );
      expect(document).not.toContain("<iframe");

      for (const concept of video.page.concepts) {
        expect(document).toContain(`href="${concept.route}"`);
      }

      const related = encoded.tube.videos.filter(
        (candidate) => candidate.id !== video.id
      );

      expect(related.length).toBeGreaterThan(0);
      expect(related.length).toBeLessThanOrEqual(4);

      for (const candidate of related) {
        expect("page" in candidate).toBe(false);
        expect(document).toContain(`href="/tube/${candidate.id}"`);
      }

      expect(document.match(/<h1(?:\s|>)/gu)).toHaveLength(1);
      const fs = yield* FileSystem.FileSystem;

      const built = yield* fs.readFileString(
        new URL("../dist/client/tube/PxIBWjiv3og/index.html", import.meta.url)
          .pathname
      );

      expect(built).toContain('"@type":"VideoObject"');
      expect(built).toContain('rel="canonical"');
    }).pipe(Effect.provide(NodeServices.layer)),
  { timeout: 60_000 }
);
