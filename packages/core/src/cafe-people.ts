import { Array as Arr, Option, Order } from "effect";

import type {
  CafeDataValue,
  CafeEvidence,
  CafeNewsItemValue,
  CafePeopleForList,
  CafePeopleForQuery,
  CafePeopleList,
  CafePeopleMatches,
  CafePeopleQuery,
  CafePeopleSearchQuery,
  CafePersonSummary,
  CafePersonValue,
  CafeProfileValue,
} from "./cafe.js";

export const allStarsRoute = (id: string) => `/all-stars/${id}`;

const lower = (value: string) => value.toLowerCase();

type Handled = Pick<CafePersonValue, "handles">;

const handlesOf = (person: Handled, kind: "github" | "x") =>
  person.handles
    .filter((entry) => entry.kind === kind)
    .map((entry) => lower(entry.handle));

const rowKeys = (row: CafeNewsItemValue) => {
  const owner = row.repo === null ? [] : [row.repo.split("/")[0] ?? ""];

  return row.author.github === null && row.author.x === null
    ? { github: owner.map(lower), x: [] }
    : {
        github: row.author.github === null ? [] : [lower(row.author.github)],
        x: row.author.x === null ? [] : [lower(row.author.x)],
      };
};

const newestFirst = Order.combine(
  Order.flip(
    Order.mapInput(Order.String, (item: CafeNewsItemValue) => item.date)
  ),
  Order.mapInput(Order.String, (item: CafeNewsItemValue) => item.url)
);

export const newsRowBelongsTo = (person: Handled, row: CafeNewsItemValue) => {
  const keys = rowKeys(row);
  const github = handlesOf(person, "github");
  const x = handlesOf(person, "x");

  return (
    keys.github.some((key) => github.includes(key)) ||
    keys.x.some((key) => x.includes(key))
  );
};

export const personNewsRows = (
  person: CafePersonValue,
  news: readonly CafeNewsItemValue[]
): readonly CafeNewsItemValue[] =>
  Arr.sort(
    news.filter((row) => newsRowBelongsTo(person, row)),
    newestFirst
  );

export const profileForNewsRow = <A extends Handled>(
  people: readonly A[],
  row: CafeNewsItemValue
): Option.Option<A> =>
  Arr.findFirst(people, (person) => newsRowBelongsTo(person, row));

export const personPackages = (person: CafePersonValue) =>
  Arr.sort(
    Arr.dedupe(
      person.repos.flatMap((repo) => repo.packages.map((entry) => entry.name))
    ),
    Order.String
  );

export const personSummary = (
  person: CafePersonValue
): typeof CafePersonSummary.Type => ({
  avatar: person.avatar.path,
  handles: person.handles,
  id: person.id,
  kind: person.kind,
  name: person.name,
  packages: personPackages(person),
  route: allStarsRoute(person.id),
  summary: person.bio[0],
  topics: person.topics.map((entry) => entry.topic),
});

export const personProfile = (
  person: CafePersonValue,
  news: readonly CafeNewsItemValue[]
): CafeProfileValue => ({
  ...person,
  newsRows: personNewsRows(person, news),
  packages: personPackages(person),
  route: allStarsRoute(person.id),
  videos: Arr.sort(
    person.videos,
    Order.flip(
      Order.mapInput(
        Order.String,
        (video: CafePersonValue["videos"][number]) => video.date
      )
    )
  ),
});

const byName = Order.mapInput(Order.String, (person: CafePersonValue) =>
  lower(person.name)
);

const defaultLimit = 30;

export const selectCafePeople = (
  data: CafeDataValue,
  query: typeof CafePeopleQuery.Type
): typeof CafePeopleList.Type => {
  const matching = Arr.sort(
    data.people.filter(
      (person) => query.kind === undefined || person.kind === query.kind
    ),
    byName
  );

  return {
    people: matching.slice(0, query.limit ?? defaultLimit).map(personSummary),
    total: matching.length,
  };
};

export const findCafePerson = (
  data: CafeDataValue,
  id: string
): Option.Option<CafeProfileValue> =>
  Arr.findFirst(data.people, (person) => person.id === lower(id.trim())).pipe(
    Option.map((person) => personProfile(person, data.news))
  );

const searchFields = (person: CafePersonValue) => [
  { label: "name", text: person.name },
  { label: "id", text: person.id },
  ...person.handles.map((entry) => ({
    label: `${entry.kind}:${entry.handle}`,
    text: entry.handle,
  })),
  ...person.topics.map((entry) => ({
    label: `topic:${entry.topic}`,
    text: entry.topic,
  })),
  ...personPackages(person).map((name) => ({
    label: `package:${name}`,
    text: name,
  })),
  ...person.repos.map((repo) => ({
    label: `repo:${repo.repo}`,
    text: `${repo.repo} ${repo.description ?? ""}`,
  })),
  ...person.bio.map((fact) => ({ label: "bio", text: fact.text })),
  ...person.videos.map((video) => ({
    label: `video:${video.url}`,
    text: video.title,
  })),
];

export const searchCafePeople = (
  data: CafeDataValue,
  query: typeof CafePeopleSearchQuery.Type
): typeof CafePeopleMatches.Type => {
  const tokens = Arr.dedupe(
    lower(query.query)
      .split(/[^a-z0-9@./_-]+/u)
      .filter((token) => token.length > 0)
  );

  const scored = data.people.flatMap((person) => {
    const fields = searchFields(person);

    const hits = tokens.filter((token) =>
      fields.some((field) => lower(field.text).includes(token))
    );

    const matched = Arr.dedupe(
      fields
        .filter((field) =>
          tokens.some((token) => lower(field.text).includes(token))
        )
        .map((field) => field.label)
    );

    return hits.length === 0 ? [] : [{ matched, person, score: hits.length }];
  });

  const ordered = Arr.sort(
    scored,
    Order.combine(
      Order.flip(
        Order.mapInput(
          Order.Number,
          (entry: (typeof scored)[number]) => entry.score
        )
      ),
      Order.mapInput(byName, (entry: (typeof scored)[number]) => entry.person)
    )
  );

  return {
    matches: ordered.slice(0, query.limit ?? defaultLimit).map((entry) => ({
      matched: entry.matched,
      person: personSummary(entry.person),
    })),
    total: ordered.length,
  };
};

const normalTerm = (term: string) =>
  lower(term.trim()).replaceAll(/\s+/gu, "-");

const termEvidence = (
  person: CafePersonValue,
  term: string
): readonly (typeof CafeEvidence.Type)[] => [
  ...person.topics
    .filter((entry) => entry.topic === term)
    .map((entry) => ({
      repo: null,
      source: entry.source,
      term,
      value: entry.topic,
      verified: entry.verified,
      via: "topic" as const,
    })),
  ...person.repos.flatMap((repo) =>
    repo.packages
      .filter((entry) => entry.name === term || entry.name.endsWith(`/${term}`))
      .map((entry) => ({
        repo: repo.repo,
        source: entry.source,
        term,
        value: entry.name,
        verified: entry.verified,
        via: "package" as const,
      }))
  ),
];

export const cafePeopleFor = (
  data: CafeDataValue,
  query: typeof CafePeopleForQuery.Type
): typeof CafePeopleForList.Type => {
  const terms = Arr.dedupe(query.terms.map(normalTerm)).filter(
    (term) => term.length > 0
  );

  const matching = data.people.flatMap((person) => {
    const evidence = terms.map((term) => termEvidence(person, term));

    return terms.length > 0 && evidence.every((found) => found.length > 0)
      ? [{ evidence: evidence.flat(), person }]
      : [];
  });

  const ordered = Arr.sort(
    matching,
    Order.combine(
      Order.flip(
        Order.mapInput(
          Order.Number,
          (entry: (typeof matching)[number]) => entry.evidence.length
        )
      ),
      Order.mapInput(byName, (entry: (typeof matching)[number]) => entry.person)
    )
  );

  return {
    people: ordered.map((entry) => ({
      evidence: entry.evidence,
      person: personSummary(entry.person),
    })),
    terms,
    total: ordered.length,
  };
};
