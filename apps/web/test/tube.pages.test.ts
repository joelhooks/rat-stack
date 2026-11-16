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
  validateTubeConcepts,
} from "../../site/scripts/tube-pages.ts";
import { transcriptChunks } from "../../site/scripts/tube-transcript.ts";
import { isReaderWebsiteRoute } from "../../site/src/reader-website.js";
import {
  readerPagePolicy,
  tubeContentSecurityPolicy,
} from "../../site/src/security.js";
import { isTubeVideoPath } from "../../site/src/tube-routes.js";
import { init } from "../src/client/reader/init.js";
import { ReaderFlags } from "../src/client/reader/model.js";
import {
  TubePage,
  assignTubeSlug,
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
    slug: `talk-video-${id
      .split("")
      .map((char) => char.codePointAt(0))
      .join("-")}`,
    published: "2025-01-01",
    take: "An example of composing work.",
    theme: "effect",
    tier: "A",
    title: `Talk ${id}`,
    url: watchUrl(id),
  };

  return withPage ? { ...base, page } : base;
};

it.prop(
  "draft slugs are readable, avoid reserved ids, and resolve collisions before storage",
  {
    title: Schema.NonEmptyString,
    count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
  },
  ({ title, count }) => {
    const assigned: string[] = [];

    for (let index = 0; index < count; index += 1) {
      const slug = assignTubeSlug(title, assigned);
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
      expect(slug).not.toMatch(/^[A-Za-z0-9_-]{11}$/u);
      expect(assigned).not.toContain(slug);
      assigned.push(slug);
    }
  }
);

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

      const routes = tubePageVideos(data).map((video) => videoPagePath(video));

      expect(routes).toEqual(
        unique
          .filter((entry) => entry.withPage)
          .map((entry) => videoPagePath(input(entry.id)))
      );
      expect(new Set(routes).size).toBe(routes.length);

      const reordered = yield* decodeTubeData(
        JSON.stringify({ videos: videos.toReversed() })
      );

      expect(
        tubePageVideos(reordered)
          .map((video) => videoPagePath(video))
          .toSorted()
      ).toEqual(routes.toSorted());

      const renamed = yield* decodeTubeData(
        JSON.stringify({
          videos: videos.map((video) => ({
            ...video,
            title: "A changed title",
          })),
        })
      );

      expect(tubePageVideos(renamed).map(videoPagePath)).toEqual(routes);

      for (const route of routes) {
        expect(isTubeVideoPath(route, data.videos)).toBe(true);
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
      2
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
          videos: [
            videoPagePath(input(id)),
            videoPagePath(input("ABCDEFGHIJK")),
          ],
        },
      ]);
    })
);

it.effect.prop(
  "wiki and glossary fragments must exist in the generated document, not just its route",
  { id: YoutubeVideoId },
  ({ id }) =>
    Effect.gen(function* fragmentsResolve() {
      const paths = ["/lore/effect-basics", "/systems/database", "/glossary"];
      const fragment = `layer-${id}`;

      const concepts = paths.map((path) => ({
        route: `${path}#${fragment}`,
        term: "Layers",
      }));

      const data = yield* decodeTubeData(
        JSON.stringify({
          videos: [{ ...input(id), page: { ...page, concepts } }],
        })
      );

      const routes = new Set(paths);

      const documents = paths.map((routePath) => ({
        routePath,
        bodyHtml: `<h2 id="${fragment}">Layers</h2>`,
      }));

      yield* validateTubeConcepts(data, routes, documents);

      const error = yield* Effect.flip(
        validateTubeConcepts(
          data,
          routes,
          documents.map((document) => ({
            ...document,
            bodyHtml: `<h2 id="${fragment}-missing">Layers</h2>`,
          }))
        )
      );

      for (const concept of concepts) {
        expect(error.message).toContain(concept.route);
      }
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

it("only published slug paths inherit the Tube policy and forwarding", () => {
  const known = "/tube/production-grade-typescript-by-johannes-schickling";

  expect(readerPagePolicy(known)).toBe(tubeContentSecurityPolicy);
  expect(isReaderRoutePath(known)).toBe(true);
  expect(isReaderWebsiteRoute(known)).toBe(true);

  for (const route of [
    "/tube/no",
    "/tube/unknown-readable-video-slug",
    "/tube/AAAAAAAAAAA",
    "/tube/PxIBWjiv3og",
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
        (entry) => entry.tube.selected === "PxIBWjiv3og"
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
        `rel="canonical" href="https://ratstack.sh${videoPagePath(video)}"`
      );
      expect(document).toContain('"@type":"VideoObject"');
      expect(document).toContain(
        `"url":"https://ratstack.sh${videoPagePath(video)}"`
      );
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
        expect(document).toContain(`href="${videoPagePath(candidate)}"`);
      }

      expect(document.match(/<h1(?:\s|>)/gu)).toHaveLength(1);
      const fs = yield* FileSystem.FileSystem;

      const built = yield* fs.readFileString(
        new URL(
          `../dist/client${videoPagePath(video)}/index.html`,
          import.meta.url
        ).pathname
      );

      expect(built).toContain('"@type":"VideoObject"');
      expect(built).toContain(
        `"url":"https://ratstack.sh${videoPagePath(video)}"`
      );
      expect(built).toContain('rel="canonical"');
    }).pipe(Effect.provide(NodeServices.layer)),
  { timeout: 60_000 }
);
