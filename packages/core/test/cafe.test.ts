import { describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  CafeProject,
  CafeStory,
  cafeLetters,
  cafeNewsScore,
  cafeSignals,
  filterCafeProjects,
  rankCafeNews,
  verifiedLetters,
} from "../src/contracts.js";
import type { CafeSignalValue } from "../src/contracts.js";
import { decodeCafeEntries } from "../src/index.js";
import {
  handle,
  isoDate,
  isoDateAfter,
  letters,
  project,
  projects,
  quietStories,
  signal,
  stories,
  story,
} from "./cafe-arbitraries.js";

const raised = (
  item: typeof CafeStory.Type,
  raisedSignal: CafeSignalValue,
  amount: number
): typeof CafeStory.Type => {
  const encoded = Schema.encodeSync(CafeStory)(item);
  const engagement = encoded.engagement ?? {};
  const current = cafeSignals(item.engagement);

  return Schema.decodeSync(CafeStory)({
    ...encoded,
    engagement: {
      ...engagement,
      [raisedSignal]: current[raisedSignal] + amount,
    },
  });
};

const urls = (items: readonly { readonly item: { readonly url: string } }[]) =>
  items.map((entry) => entry.item.url);

describe("cafeNewsScore", () => {
  it.prop(
    "raising any single signal never lowers the score",
    {
      amount: Arbitrary.schema(
        Schema.Int.check(Schema.isBetween({ maximum: 100_000, minimum: 1 }))
      ),
      item: story,
      now: isoDate,
      raisedSignal: signal,
    },
    ({ amount, item, now, raisedSignal }) => {
      expect(
        cafeNewsScore(raised(item, raisedSignal, amount), now)
      ).toBeGreaterThanOrEqual(cafeNewsScore(item, now));
    }
  );

  it.prop(
    "a later GitHub push never lowers the score",
    {
      days: Arbitrary.schema(
        Schema.Int.check(Schema.isBetween({ maximum: 400, minimum: 0 }))
      ),
      item: story,
      now: isoDate,
    },
    ({ days, item, now }) => {
      const pushedAt = isoDateAfter(item.date, days);

      expect(
        cafeNewsScore(
          { ...item, engagement: { ...item.engagement, pushedAt } },
          now
        )
      ).toBeGreaterThanOrEqual(
        cafeNewsScore(
          { ...item, engagement: { ...item.engagement, pushedAt: item.date } },
          now
        )
      );
    }
  );

  it.prop(
    "the score never rises as the entry gets older",
    {
      days: Arbitrary.schema(
        Schema.Int.check(Schema.isBetween({ maximum: 400, minimum: 0 }))
      ),
      item: story,
      now: isoDate,
    },
    ({ days, item, now }) => {
      expect(cafeNewsScore(item, isoDateAfter(now, days))).toBeLessThanOrEqual(
        cafeNewsScore(item, now)
      );
    }
  );

  it.prop(
    "missing signals score the same as zero signals",
    { item: story, now: isoDate },
    ({ item, now }) => {
      const { engagement: _engagement, ...bare } = item;

      expect(cafeNewsScore(bare, now)).toBe(
        cafeNewsScore(
          {
            ...bare,
            engagement: {
              likes: 0,
              participants: 0,
              replies: 0,
              seen: 0,
              stars: 0,
              views: 0,
            },
          },
          now
        )
      );
    }
  );
});

describe("rankCafeNews", () => {
  it.prop(
    "ranking is a total, input-order-independent permutation",
    { items: stories, now: isoDate, quiet: quietStories },
    ({ items: loud, now, quiet }) => {
      const items = [...loud, ...quiet];
      const ranked = rankCafeNews(items, now);
      const reversed = rankCafeNews(items.toReversed(), now);

      const rotated = rankCafeNews(
        [...items.slice(1), ...items.slice(0, 1)],
        now
      );

      expect(urls(ranked).toSorted()).toStrictEqual(
        items.map((item) => item.url).toSorted()
      );
      expect(urls(reversed)).toStrictEqual(urls(ranked));
      expect(urls(rotated)).toStrictEqual(urls(ranked));
    }
  );

  it.prop(
    "equal scores fall back to newest date, then url",
    { author: handle, item: story, now: isoDate },
    ({ author, item, now }) => {
      const twin = (path: string, date: string) =>
        Schema.decodeSync(CafeStory)({
          ...Schema.encodeSync(CafeStory)(item),
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
