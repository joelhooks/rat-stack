import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { fenceMessage } from "../../../packages/core/test/fixtures/fence-message.js";
import {
  tubeDataUnreadable,
  tubeManifestMissing,
} from "../../site/scripts/reader-tube-flags.ts";
import {
  decodeTubeData,
  tubeDataProblems,
  unreadableTubeFile,
} from "../../site/scripts/tube-pages.ts";
import {
  rankTube,
  TubeTheme,
  TubeTier,
  tubeTiers,
  watchUrl,
  YoutubeVideoId,
} from "../src/client/tube/data.js";

const tier = Arbitrary.schema(TubeTier);

const ranked = Arbitrary.array(tier, { maxLength: 40 });

const entry = Arbitrary.all({
  id: Arbitrary.schema(YoutubeVideoId),
  theme: Arbitrary.schema(TubeTheme),
  tier,
});

const video = (generated: {
  readonly id: string;
  readonly theme: string;
  readonly tier: string;
}) => ({
  basis: "transcript",
  channel: "Effect | TypeScript for the AI Era",
  channelUrl: "https://www.youtube.com/@effect-ts",
  checked: "2026-11-08",
  durationSeconds: 1617,
  id: generated.id,
  published: "2024-03-26",
  take: "A talk about typed failures. You learn how services compose.",
  theme: generated.theme,
  tier: generated.tier,
  title: "Production-Grade TypeScript",
  url: watchUrl(generated.id),
});

type Video = ReturnType<typeof video>;

const uniqueEntries = Arbitrary.array(entry, {
  maxLength: 8,
  minLength: 2,
}).pipe(
  Arbitrary.map((entries) =>
    entries.filter(
      (candidate, index) =>
        entries.findIndex((other) => other.id === candidate.id) === index
    )
  )
);

const faults = {
  duplicateId: (target: Video, first: Video, where: string) => ({
    entry: { ...target, id: first.id, url: watchUrl(first.id) },
    expected: `${where} repeats id ${first.id} from videos[0]`,
  }),
  httpUrl: (target: Video, _first: Video, where: string) => ({
    entry: { ...target, url: `http://www.youtube.com/watch?v=${target.id}` },
    expected: `${where}.url is not an https URL`,
  }),
  longTake: (target: Video, _first: Video, where: string) => ({
    entry: { ...target, take: "One. Two. Three. Four." },
    expected: `${where} has no valid take`,
  }),
  missingTake: (target: Video, _first: Video, where: string) => {
    const { take: _take, ...withoutTake } = target;

    return { entry: withoutTake, expected: `${where} has no valid take` };
  },
  unknownBasis: (target: Video, _first: Video, where: string) => ({
    entry: { ...target, basis: "vibes" },
    expected: `${where}.basis is not a take basis`,
  }),
  unknownTheme: (target: Video, _first: Video, where: string) => ({
    entry: { ...target, theme: "rust" },
    expected: `${where}.theme is not a tube theme`,
  }),
};

const fault = Arbitrary.schema(
  Schema.Literals([
    "duplicateId",
    "httpUrl",
    "longTake",
    "missingTake",
    "unknownBasis",
    "unknownTheme",
  ])
);

describe("tube ranking", () => {
  it.prop(
    "ranking orders tiers from S to F and keeps the editorial order inside a tier",
    { tiers: ranked },
    ({ tiers }) => {
      const input = tiers.map((value, position) => ({ position, tier: value }));
      const output = rankTube(input);

      expect(
        output.toSorted((left, right) => left.position - right.position)
      ).toEqual(input);

      for (const [index, current] of output.entries()) {
        const next = output[index + 1];

        if (next !== undefined) {
          const order =
            tubeTiers.indexOf(current.tier) - tubeTiers.indexOf(next.tier);

          expect(order).toBeLessThanOrEqual(0);

          if (order === 0) {
            expect(current.position).toBeLessThan(next.position);
          }
        }
      }
    }
  );
});

describe("tube data validation", () => {
  it.prop(
    "a well-formed list has no problems",
    { entries: uniqueEntries },
    ({ entries }) => {
      expect(tubeDataProblems({ videos: entries.map(video) })).toEqual([]);
    }
  );

  it.prop(
    "one planted fault yields one fence message that names the entry and the field",
    {
      entries: uniqueEntries,
      kind: fault,
      pick: Arbitrary.schema(
        Schema.Int.check(Schema.isBetween({ maximum: 7, minimum: 1 }))
      ),
    },
    ({ entries, kind, pick }) => {
      const videos = entries.map(video);
      const index = Math.min(pick, videos.length - 1);
      const [first] = videos;
      const target = videos[index];

      expect(first).toBeDefined();
      expect(target).toBeDefined();

      if (first === undefined || target === undefined) {
        return;
      }

      const planted = faults[kind](target, first, `videos[${index}]`);

      const problems = tubeDataProblems({
        videos: videos.map((current, position) =>
          position === index ? planted.entry : current
        ),
      });

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(planted.expected);
      expect(fenceMessage(problems[0] ?? "")).toBeDefined();
    }
  );

  it.effect(
    "a file that is not an object with a videos array is one fence message",
    () =>
      Effect.gen(function* readBrokenFile() {
        for (const text of ["[]", "{", '{"items":[]}']) {
          const error = yield* Effect.flip(decodeTubeData(text));

          expect(error.problems).toEqual([unreadableTubeFile]);
        }

        expect(fenceMessage(unreadableTubeFile)).toBeDefined();
      })
  );

  it("the reader's tube input failures read as fence messages", () => {
    for (const message of [tubeManifestMissing, tubeDataUnreadable]) {
      expect(fenceMessage(message), message).toBeDefined();
    }
  });
});
