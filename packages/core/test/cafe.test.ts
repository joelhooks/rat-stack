import { describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  CafeProject,
  CafeStory,
  cafeLetters,
  CafeInterest,
  filterCafeProjects,
  rankCafeNews,
  verifiedLetters,
} from "../src/contracts.js";
import { decodeCafeEntries } from "../src/index.js";
import {
  handle,
  isoDate,
  isoDateAfter,
  letters,
  project,
  projects,
  quietStories,
  threads,
  stories,
  story,
} from "./cafe-arbitraries.js";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ maximum, minimum })));

const urls = (items: readonly { readonly item: { readonly url: string } }[]) =>
  items.map((entry) => entry.item.url);

const interest = (editorial: number, topic: string) =>
  CafeInterest.make({
    editorial,
    substance: "proof",
    topic: Schema.decodeSync(CafeInterest.fields.topic)(topic),
    why: "Shows a useful technique",
  });

describe("rankCafeNews", () => {
  it.prop(
    "ranking is a total, input-order-independent permutation",
    { now: isoDate, quiet: quietStories, stories, threads },
    ({ now, quiet, stories: generatedStories, threads: generatedThreads }) => {
      const items = [...generatedStories, ...quiet, ...generatedThreads];
      const ranked = rankCafeNews(items, now);
      const reversed = rankCafeNews(items.toReversed(), now);

      const rotated = rankCafeNews(
        [...items.slice(1), ...items.slice(0, 1)],
        now
      );

      expect(urls(ranked).toSorted()).toStrictEqual(
        items.map((item) => item.url).toSorted()
      );
      expect(reversed).toStrictEqual(ranked);
      expect(rotated).toStrictEqual(ranked);
    }
  );

  it.prop(
    "release and post stars do not change any score",
    { item: story, now: isoDate, stars: int(1, 1_000_000) },
    ({ item, now, stars }) => {
      const twin = (kind: "post" | "release", slug: string) =>
        Schema.decodeSync(CafeStory)({
          ...item,
          engagement: { ...item.engagement, stars: 0 },
          kind,
          url: `https://example.com/${kind}/${slug}`,
        });

      const post = twin("post", "a");
      const release = twin("release", "a");
      const others = [twin("post", "b"), twin("release", "b")];

      expect(
        rankCafeNews(
          [
            ...[post, release].map((row) => ({
              ...row,
              engagement: { ...row.engagement, stars },
            })),
            ...others,
          ],
          now
        ).map((entry) => ({ score: entry.score, url: entry.item.url }))
      ).toStrictEqual(
        rankCafeNews([post, release, ...others], now).map((entry) => ({
          score: entry.score,
          url: entry.item.url,
        }))
      );
    }
  );

  it.prop(
    "raising one row's editorial never lowers its position",
    {
      editorial: int(0, 2),
      item: story,
      now: isoDate,
      others: stories,
      topicOffset: int(0, 2),
    },
    ({ editorial, item, now, others, topicOffset }) => {
      const target = { ...item, interest: interest(editorial, "topic-a") };

      const rest = others
        .filter((row) => row.url !== target.url)
        .map((row, index) => ({
          ...row,
          interest: interest(
            (index + topicOffset) % 4,
            index % 2 === 0 ? "topic-a" : "topic-b"
          ),
        }));

      const position = (row: typeof target) =>
        urls(rankCafeNews([row, ...rest], now)).indexOf(target.url);

      expect(
        position({ ...target, interest: interest(editorial + 1, "topic-a") })
      ).toBeLessThanOrEqual(position(target));
    }
  );

  it.prop(
    "a higher placement on the topic with lower editorial cannot demote the target",
    { editorial: int(1, 3), item: story, now: isoDate, daysApart: int(8, 21) },
    ({ editorial, item, now, daysApart }) => {
      const row = (name: string, points: number, topic: string, days: number) =>
        Schema.decodeSync(CafeStory)({
          ...item,
          author: { github: null, x: null },
          date: isoDateAfter(now, -days),
          engagement: {},
          interest: interest(points, topic),
          kind: "post",
          url: `https://${name}.example/article`,
        });

      const low = row("low", editorial - 1, "other-topic", 0);
      const high = row("high", editorial, "same-topic", daysApart);
      const rival = row("rival", editorial, "other-topic", daysApart + 1);

      const positions = (topic: string) =>
        urls(
          rankCafeNews(
            [{ ...low, interest: interest(editorial - 1, topic) }, high, rival],
            now
          )
        );

      expect(positions("same-topic")).toStrictEqual(positions("third-topic"));
      expect(positions("same-topic")).toStrictEqual([
        low.url,
        high.url,
        rival.url,
      ]);
    }
  );

  it.prop(
    "older never scores better, and a later push refreshes the row",
    { days: int(1, 400), item: story, now: isoDate },
    ({ days, item, now }) => {
      const [young] = rankCafeNews(
        [{ ...item, date: now, engagement: {} }],
        now
      );

      const date = isoDateAfter(now, -days);
      const [old] = rankCafeNews([{ ...item, date, engagement: {} }], now);

      const [pushed] = rankCafeNews(
        [{ ...item, date, engagement: { pushedAt: now } }],
        now
      );

      expect(old?.score).toBeLessThan(young?.score ?? Number.NEGATIVE_INFINITY);
      expect(pushed?.score).toBe(young?.score);
    }
  );

  it.prop(
    "equal scores fall back to newest date, then url",
    { author: handle, item: story, now: isoDate },
    ({ author, item, now }) => {
      const twin = (path: string, date: string) =>
        Schema.decodeSync(CafeStory)({
          ...Schema.encodeSync(CafeStory)(item),
          kind: "post",
          author: { github: null, x: `${author}${path}` },
          date,
          engagement: {},
          url: `https://t${path}.example/${path}`,
        });

      const ranked = rankCafeNews(
        [twin("b", now), twin("a", now), twin("c", isoDateAfter(now, 1))],
        now
      );

      expect(urls(ranked)).toStrictEqual([
        "https://tc.example/c",
        "https://ta.example/a",
        "https://tb.example/b",
      ]);
    }
  );
});

describe("directory filter", () => {
  it.prop(
    "verified letters follow C, A, F, E order and name only stack evidence",
    { candidate: project },
    ({ candidate }) => {
      expect(verifiedLetters(candidate)).toStrictEqual(
        cafeLetters.filter((letter) => candidate.stack[letter] !== null)
      );
    }
  );

  it.prop(
    "adding a letter to the filter never adds a project",
    { chosen: letters, extra: letters, list: projects },
    ({ chosen, extra, list }) => {
      const narrow = filterCafeProjects(list, [...chosen, ...extra]);
      const wide = filterCafeProjects(list, chosen);

      expect(narrow.every((entry) => wide.includes(entry))).toBe(true);
      expect(filterCafeProjects(list, [])).toStrictEqual(list);
    }
  );
});

const oneProject = {
  author: { github: "ada", x: null },
  date: "2026-10-01",
  repo: "ada/one",
  source: "https://github.com/ada/one",
  stack: {
    alchemy: null,
    cloudflare: null,
    effect: "package.json depends on effect",
    foldkit: null,
  },
  stars: null,
  summary: "One project.",
  title: "one",
  url: "https://github.com/ada/one",
};

describe("decodeCafeEntries", () => {
  it.effect.prop(
    "reports the index and field of every corrupted entry and nothing else",
    {
      corrupt: Arbitrary.array(Arbitrary.schema(Schema.Boolean), {
        maxLength: 12,
      }),
      list: projects,
    },
    ({ corrupt, list }) =>
      Effect.gen(function* reportEveryCorruptedEntry() {
        const values = list.map((entry, index) =>
          corrupt[index] === true
            ? { ...Schema.encodeSync(CafeProject)(entry), summary: "" }
            : Schema.encodeSync(CafeProject)(entry)
        );

        const result = yield* Effect.result(
          decodeCafeEntries(CafeProject, "projects.json", values)
        );

        const expected = list.flatMap((_entry, index) =>
          corrupt[index] === true ? [index] : []
        );

        const reported = Result.match(result, {
          onFailure: (issues) => issues,
          onSuccess: () => [],
        });

        expect(Result.isSuccess(result)).toBe(expected.length === 0);
        expect(reported.map((issue) => issue.index)).toStrictEqual(expected);
        expect(
          reported.every(
            (issue) =>
              issue.field === "summary" && issue.file === "projects.json"
          )
        ).toBe(true);
      })
  );

  it.effect("names every repeated url after its first entry", () =>
    Effect.gen(function* reportDuplicateUrls() {
      const result = yield* Effect.flip(
        decodeCafeEntries(CafeProject, "projects.json", [
          oneProject,
          oneProject,
          oneProject,
        ])
      );

      expect(result.map((error) => [error.index, error.field])).toStrictEqual([
        [1, "url"],
        [2, "url"],
      ]);
    })
  );
});
