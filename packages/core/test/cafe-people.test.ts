import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Effect, FileSystem, Option, Path, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  cafeNewsFile,
  cafePeopleFile,
  cafeProjectsFile,
  decodeCafeData,
  describeCafeDataError,
} from "../src/cafe-data.js";
import {
  CafeDirectory,
  peopleFor,
  readPerson,
  searchPeople,
} from "../src/cafe-directory.js";
import {
  cafePeopleFor,
  personNewsRows,
  profileForNewsRow,
  unlistedAuthors,
} from "../src/cafe-people.js";
import { CafePerson, CafeStory, IsoDate } from "../src/contracts.js";
import type { CafePersonValue } from "../src/contracts.js";
import { isoDate, stories } from "./cafe-arbitraries.js";

const verified = {
  source: "https://github.com/example",
  verified: "2026-11-02",
};

const person = (index: number): CafePersonValue =>
  Schema.decodeSync(CafePerson)({
    avatar: { path: `/avatars/p${index}.png`, ...verified },
    bio: [
      { text: `Person ${index} builds CAFE things.`, ...verified },
      { text: `Person ${index} posts about them.`, ...verified },
    ],
    entry: {
      kind: "news",
      rows: [
        `https://example.com/p${index}/first`,
        `https://example.com/p${index}/second`,
      ],
    },
    handles: [
      {
        handle: `gh${index}`,
        kind: "github",
        url: `https://github.com/gh${index}`,
        ...verified,
      },
      {
        handle: `x${index}`,
        kind: "x",
        url: `https://x.com/x${index}`,
        ...verified,
      },
    ],
    id: `p${index}`,
    kind: index % 2 === 0 ? "person" : "channel",
    name: `Person ${index}`,
    repos: [],
    topics: [],
    updated: "2026-11-02",
    videos: [],
  });

const peopleArbitrary = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 1 }))
).pipe(
  Arbitrary.map((count) =>
    Array.from({ length: count }, (_unused, index) => person(index))
  )
);

const via = Arbitrary.schema(Schema.Literals(["github", "x", "repo"]));

const authoredRow = Arbitrary.all({
  date: isoDate,
  owner: Arbitrary.schema(
    Schema.Int.check(Schema.isBetween({ maximum: 9, minimum: 0 }))
  ),
  shout: Arbitrary.schema(Schema.Boolean),
  slug: Arbitrary.schema(
    Schema.Int.check(Schema.isBetween({ maximum: 1_000_000, minimum: 0 }))
  ),
  via,
}).pipe(
  Arbitrary.map((generated) => {
    const cased = (handle: string) =>
      generated.shout ? handle.toUpperCase() : handle;

    return {
      owner: generated.owner,
      row: Schema.decodeSync(CafeStory)({
        author: {
          github:
            generated.via === "github" ? cased(`gh${generated.owner}`) : null,
          x: generated.via === "x" ? cased(`x${generated.owner}`) : null,
        },
        date: generated.date,
        kind: "post",
        repo:
          generated.via === "repo"
            ? `${cased(`gh${generated.owner}`)}/project`
            : null,
        source: "https://example.com/source",
        summary: "A generated row.",
        title: "A generated row",
        url: `https://example.com/authored/${generated.slug}`,
      }),
    };
  })
);

const isNewestFirst = (rows: readonly { readonly date: string }[]) =>
  rows.every(
    (row, index) => index === 0 || (rows[index - 1]?.date ?? "") >= row.date
  );

const authoredRows = Arbitrary.array(authoredRow, {
  maxLength: 12,
  minLength: 1,
}).pipe(
  Arbitrary.map((rows) =>
    rows.filter(
      (entry, index) =>
        rows.findIndex((candidate) => candidate.row.url === entry.row.url) ===
        index
    )
  )
);

describe("the news author join", () => {
  it.prop(
    "a row authored by one profile's handle lands on exactly that profile, newest first",
    { authored: authoredRows, news: stories, people: peopleArbitrary },
    ({ authored, news, people }) => {
      const all = [...news, ...authored.map((entry) => entry.row)];

      for (const entry of authored) {
        const holders = people.filter((candidate) =>
          personNewsRows(candidate, all).some(
            (item) => item.url === entry.row.url
          )
        );

        const owner = people
          .filter((candidate) => candidate.id === `p${entry.owner}`)
          .map((candidate) => candidate.id);

        expect(holders.map((holder) => holder.id)).toStrictEqual(owner);
        expect(
          Option.map(profileForNewsRow(people, entry.row), (found) => found.id)
        ).toStrictEqual(Arr.head(owner));
      }

      for (const candidate of people) {
        const rows = personNewsRows(candidate, all);

        expect(isNewestFirst(rows)).toBe(true);
        expect(rows.map((item) => item.url).toSorted()).toStrictEqual(
          authored
            .filter((entry) => `p${entry.owner}` === candidate.id)
            .map((entry) => entry.row.url)
            .toSorted()
        );
      }
    }
  );
});

const termHolder = Arbitrary.all({
  packages: Arbitrary.schema(
    Schema.Int.check(Schema.isBetween({ maximum: 4, minimum: 0 }))
  ),
  topic: Arbitrary.schema(Schema.Boolean),
});

const withFoldkit = (
  index: number,
  holder: { readonly packages: number; readonly topic: boolean }
): CafePersonValue =>
  Schema.decodeSync(CafePerson)({
    ...Schema.encodeSync(CafePerson)(person(index)),
    repos: Array.from({ length: holder.packages }, (_unused, repo) => ({
      description: null,
      packages: [{ name: "foldkit", ...verified }],
      repo: `gh${index}/app-${repo}`,
      stars: 0,
      ...verified,
    })),
    topics: holder.topic ? [{ topic: "foldkit", ...verified }] : [],
  });

describe("the entry rule warning", () => {
  it.prop(
    "names exactly the authors with any rows that no profile owns",
    [
      authoredRows,
      Arbitrary.schema(
        Schema.Int.check(Schema.isBetween({ maximum: 9, minimum: 0 }))
      ),
    ],
    ([authored, listed]) => {
      const people = Array.from({ length: listed }, (_unused, index) =>
        person(index)
      );

      const handleOf = (entry: (typeof authored)[number]) =>
        entry.row.author.x === null
          ? `github:gh${entry.owner}`
          : `x:x${entry.owner}`;

      const unowned = authored.filter((entry) => entry.owner >= listed);

      const counts = Arr.dedupe(unowned.map(handleOf)).map((author) => ({
        author,
        rows: unowned.filter((entry) => handleOf(entry) === author).length,
      }));

      const warned = unlistedAuthors(
        people,
        authored.map((entry) => entry.row)
      );

      expect(warned).toStrictEqual(
        counts.toSorted((left, right) =>
          left.author.localeCompare(right.author)
        )
      );
    }
  );
});

describe("peopleFor ranking", () => {
  it.prop(
    "people known for a term rank ahead of people who only list its package, however many repos list it",
    [Arbitrary.array(termHolder, { maxLength: 6, minLength: 1 })],
    ([holders]) => {
      const people = holders.map((holder, index) => withFoldkit(index, holder));

      const answer = cafePeopleFor(
        {
          news: [],
          people,
          projects: [],
          rankedAt: Schema.decodeSync(IsoDate)("2026-11-02"),
        },
        { terms: ["foldkit"] }
      );

      const knownFor = answer.people.map((entry) =>
        entry.evidence.some((fact) => fact.via === "topic")
      );

      expect(
        answer.people.map((entry) => entry.person.id).toSorted()
      ).toStrictEqual(
        people
          .filter((_entry, index) => {
            const holder = holders[index];

            return (
              holder !== undefined && (holder.topic || holder.packages > 0)
            );
          })
          .map((entry) => entry.id)
          .toSorted()
      );
      expect(knownFor).toStrictEqual(
        knownFor.toSorted((left, right) => Number(right) - Number(left))
      );
    }
  );
});

const seedData = Effect.gen(function* readSeedData() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "../../..");
  const read = (file: string) => fs.readFileString(path.join(root, file));

  return yield* decodeCafeData({
    news: yield* read(cafeNewsFile),
    people: yield* read(cafePeopleFile),
    projects: yield* read(cafeProjectsFile),
  });
});

const ask = <A, E>(question: Effect.Effect<A, E, CafeDirectory>) =>
  seedData.pipe(
    Effect.flatMap((data) =>
      question.pipe(Effect.provide(CafeDirectory.layer(data)))
    )
  );

it.layer(NodeServices.layer)("agent questions over the seed data", (test) => {
  test.effect("who should I learn Foldkit from?", () =>
    Effect.gen(function* learnFoldkit() {
      const answer = yield* ask(peopleFor.handler({ terms: ["Foldkit"] }));

      const knownFor = (entry: (typeof answer.people)[number]) =>
        entry.evidence.some((fact) => fact.via === "topic");

      const ranks = answer.people.map(knownFor);

      expect(answer.people.map((entry) => entry.person.id)).toContain(
        "devinjameson"
      );
      expect(ranks[0]).toBe(true);
      expect(ranks).toStrictEqual(
        ranks.toSorted((left, right) => Number(right) - Number(left))
      );
      expect(
        answer.people.every((entry) =>
          entry.evidence.every((fact) => fact.source.startsWith("https://"))
        )
      ).toBe(true);

      const profile = yield* ask(readPerson.handler({ id: "devinjameson" }));

      expect(profile.bio.length).toBeGreaterThanOrEqual(2);
      expect(profile.newsRows.length).toBeGreaterThan(0);
    })
  );

  test.effect("who do I ask about Alchemy Durable Objects?", () =>
    Effect.gen(function* askAlchemyDurableObjects() {
      const answer = yield* ask(
        peopleFor.handler({ terms: ["alchemy", "durable objects"] })
      );

      const searched = yield* ask(
        searchPeople.handler({ query: "durable objects" })
      );

      expect(answer.people.map((entry) => entry.person.id)).toStrictEqual([
        "sam-goodwin",
      ]);
      expect(
        searched.matches.find((match) => match.person.id === "sam-goodwin")
          ?.matched
      ).toContain("topic:durable-objects");
    })
  );

  test.effect("whose repo shows Effect plus D1?", () =>
    Effect.gen(function* findEffectAndD1() {
      const answer = yield* ask(peopleFor.handler({ terms: ["effect", "d1"] }));

      expect(answer.people.map((entry) => entry.person.id)).toStrictEqual([
        "effect-ts",
      ]);
      expect(
        answer.people[0]?.evidence.flatMap((fact) =>
          fact.repo === null ? [] : [fact.repo]
        )
      ).toContain("Effect-TS/effect");
    })
  );

  test.effect("an unknown id names the capability that lists ids", () =>
    Effect.gen(function* unknownPerson() {
      const failure = yield* Effect.flip(
        ask(readPerson.handler({ id: "nobody-here" }))
      );

      expect(failure._tag).toBe("UnknownPerson");
      expect(failure.message).toContain("listPeople");
    })
  );
});

describe("decodeCafeData", () => {
  it.effect(
    "names every bad people field, empty news entry, and repeated id",
    () =>
      Effect.gen(function* reportPeopleErrors() {
        const good = yield* Schema.encodeEffect(CafePerson)(person(0));

        const story = {
          author: { github: "gh0", x: null },
          date: "2026-11-01",
          kind: "post",
          repo: null,
          source: "https://example.com/source",
          summary: "A row.",
          title: "A row",
          url: "https://example.com/row",
        };

        const failure = yield* Effect.flip(
          decodeCafeData({
            news: JSON.stringify([story]),
            people: JSON.stringify([
              { ...good, bio: [good.bio[0]] },
              { ...good, entry: { kind: "news", rows: [] }, id: "p1" },
              good,
              good,
            ]),
            projects: "[]",
          })
        );

        expect(failure.errors.map(describeCafeDataError)).toStrictEqual([
          expect.stringMatching(
            /^\.brain\/data\/cafe\/people\.json\[0\]\.bio: /u
          ),
          expect.stringMatching(
            /^\.brain\/data\/cafe\/people\.json\[1\]\.entry\.rows\.0: /u
          ),
          expect.stringMatching(
            /^\.brain\/data\/cafe\/people\.json\[3\]\.id: Duplicate id p0/u
          ),
        ]);
      })
  );
});
