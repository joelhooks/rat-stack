import { Array as Arr, DateTime, Option, Order, Schema } from "effect";

export const CafeLetter = Schema.Literals([
  "cloudflare",
  "alchemy",
  "foldkit",
  "effect",
]);

export type CafeLetterValue = typeof CafeLetter.Type;

export const cafeLetters = CafeLetter.literals;

export const cafeLetterInitial = {
  alchemy: "A",
  cloudflare: "C",
  effect: "E",
  foldkit: "F",
} as const satisfies Record<CafeLetterValue, string>;

const isCalendarDate = Schema.makeFilter<string>(
  (value) =>
    Option.exists(
      DateTime.make(`${value}T00:00:00Z`),
      (date) => DateTime.formatIsoDateUtc(date) === value
    ),
  { expected: "a real calendar date in YYYY-MM-DD form" }
);

export const IsoDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u),
  isCalendarDate
).pipe(Schema.brand("IsoDate"));

export type IsoDateValue = typeof IsoDate.Type;

export const GithubLogin = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u)
).pipe(Schema.brand("GithubLogin"));

export const XHandle = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_]{1,15}$/u)
).pipe(Schema.brand("XHandle"));

export const RepoName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/u)
).pipe(Schema.brand("RepoName"));

export const HttpsUrl = Schema.String.check(
  Schema.isPattern(/^https:\/\/[^\s/]+(?:\/\S*)?$/u)
).pipe(Schema.brand("HttpsUrl"));

export const XStatusUrl = Schema.String.check(
  Schema.isPattern(/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+$/u)
).pipe(Schema.brand("XStatusUrl"));

export const OneLine = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isTrimmed(),
  Schema.isMaxLength(280),
  Schema.isPattern(/^[^\n\r]*$/u)
);

export const CafeDescription = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isTrimmed(),
  Schema.isMaxLength(350),
  Schema.isPattern(/^[^\n\r]*$/u)
);

export const ReplyText = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isTrimmed(),
  Schema.isMaxLength(560)
);

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const CafeAuthor = Schema.Struct({
  github: Schema.NullOr(GithubLogin),
  x: Schema.NullOr(XHandle),
});

export const CafeStackEvidence = Schema.Struct({
  alchemy: Schema.NullOr(OneLine),
  cloudflare: Schema.NullOr(OneLine),
  effect: Schema.NullOr(OneLine),
  foldkit: Schema.NullOr(OneLine),
});

export const CafeProject = Schema.Struct({
  author: CafeAuthor,
  date: IsoDate,
  repo: RepoName,
  source: HttpsUrl,
  stack: CafeStackEvidence,
  stars: Schema.NullOr(Count),
  summary: CafeDescription,
  title: OneLine,
  url: HttpsUrl,
});

export type CafeProjectValue = typeof CafeProject.Type;

export const CafeEngagement = Schema.Struct({
  bookmarks: Schema.optionalKey(Count),
  likes: Schema.optionalKey(Count),
  participants: Schema.optionalKey(Count),
  peers: Schema.optionalKey(Schema.Array(XHandle)),
  pushedAt: Schema.optionalKey(IsoDate),
  replies: Schema.optionalKey(Count),
  seen: Schema.optionalKey(Count),
  stars: Schema.optionalKey(Count),
  views: Schema.optionalKey(Count),
});

export type CafeEngagementValue = typeof CafeEngagement.Type;

export const CafeReply = Schema.Struct({
  likes: Count,
  text: ReplyText,
  url: XStatusUrl,
  x: XHandle,
});

export const CafeTopic = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
).pipe(Schema.brand("CafeTopic"));

export const CAFE_EDITORIAL_MAX = 3;

const CafeWhy = OneLine.check(Schema.isMinLength(3), Schema.isMaxLength(60));

export const CafeInterest = Schema.Struct({
  editorial: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: CAFE_EDITORIAL_MAX })
  ),
  substance: Schema.Literals([
    "proof",
    "technique",
    "demo",
    "release",
    "tool",
    "announcement",
  ]),
  topic: CafeTopic,
  why: CafeWhy,
});

const storyFields = {
  author: CafeAuthor,
  date: IsoDate,
  engagement: Schema.optionalKey(CafeEngagement),
  interest: Schema.optionalKey(CafeInterest),
  repo: Schema.NullOr(RepoName),
  source: HttpsUrl,
  summary: OneLine,
  title: OneLine,
  url: HttpsUrl,
};

export const CafeStory = Schema.Struct({
  ...storyFields,
  kind: Schema.Literals(["release", "post", "video", "launch"]),
});

export const CafeThread = Schema.Struct({
  ...storyFields,
  author: Schema.Struct({ ...CafeAuthor.fields, x: XHandle }),
  engagement: Schema.Struct({
    ...CafeEngagement.fields,
    likes: Count,
    participants: Count,
    replies: Count,
  }),
  kind: Schema.Literal("thread"),
  summary: Schema.NullOr(OneLine),
  topReplies: Schema.Array(CafeReply).check(Schema.isMaxLength(3)),
  url: XStatusUrl,
});

export const CafeNewsItem = Schema.Union([CafeStory, CafeThread]);

export type CafeNewsItemValue = typeof CafeNewsItem.Type;

export const CafeNewsKind = Schema.Literals([
  "release",
  "post",
  "video",
  "launch",
  "thread",
]);

export type CafeNewsKindValue = typeof CafeNewsKind.Type;

export const CafeNewsSort = Schema.Literals(["rank", "newest"]);

export const CafeProjectSort = Schema.Literals(["updated", "stars"]);

export const RankedCafeNewsItem = Schema.Struct({
  item: CafeNewsItem,
  score: Schema.Finite,
  why: Schema.NullOr(CafeWhy),
});

export type RankedCafeNewsItemValue = typeof RankedCafeNewsItem.Type;

export const PersonId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]{0,38})$/u)
).pipe(Schema.brand("PersonId"));

export const PackageName = Schema.String.check(
  Schema.isPattern(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u)
).pipe(Schema.brand("PackageName"));

export const AvatarPath = Schema.String.check(
  Schema.isPattern(/^\/avatars\/[a-z0-9-]+\.(?:png|jpg)$/u)
);

const verified = { source: HttpsUrl, verified: IsoDate };

export const CafeHandleKind = Schema.Literals([
  "github",
  "x",
  "youtube",
  "blog",
  "site",
]);

export const CafeHandle = Schema.Struct({
  handle: OneLine,
  kind: CafeHandleKind,
  url: HttpsUrl,
  ...verified,
});

export const CafeFact = Schema.Struct({ text: CafeDescription, ...verified });

export const CafeTopicFact = Schema.Struct({ topic: CafeTopic, ...verified });

export const CafePackageFact = Schema.Struct({
  name: PackageName,
  ...verified,
});

export const CafePersonRepo = Schema.Struct({
  description: Schema.NullOr(CafeDescription),
  packages: Schema.Array(CafePackageFact),
  repo: RepoName,
  stars: Count,
  ...verified,
});

export const CafeVideo = Schema.Struct({
  date: IsoDate,
  title: OneLine,
  url: HttpsUrl,
  ...verified,
});

export const CafePersonKind = Schema.Literals(["person", "channel"]);

export const CafePersonEntry = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("news"),
    rows: Schema.NonEmptyArray(HttpsUrl),
  }),
  Schema.Struct({
    kind: Schema.Literal("stack"),
    package: PackageName,
    source: HttpsUrl,
  }),
  Schema.Struct({ kind: Schema.Literal("vendored"), source: HttpsUrl }),
  Schema.Struct({
    kind: Schema.Literal("work"),
    project: HttpsUrl,
    ...verified,
  }),
]);

export const CafePerson = Schema.Struct({
  avatar: Schema.Struct({ path: AvatarPath, ...verified }),
  bio: Schema.NonEmptyArray(CafeFact).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(3)
  ),
  entry: CafePersonEntry,
  handles: Schema.NonEmptyArray(CafeHandle),
  id: PersonId,
  kind: CafePersonKind,
  name: OneLine,
  repos: Schema.Array(CafePersonRepo),
  topics: Schema.Array(CafeTopicFact),
  updated: IsoDate,
  videos: Schema.Array(CafeVideo),
});

export type CafePersonValue = typeof CafePerson.Type;

export const CafeData = Schema.Struct({
  news: Schema.Array(CafeNewsItem),
  people: Schema.Array(CafePerson),
  projects: Schema.Array(CafeProject),
  rankedAt: IsoDate,
});

export type CafeDataValue = typeof CafeData.Type;

export const CAFE_AGE_DAYS_PER_POINT = 7;

export const CAFE_DIVERSITY_PENALTY = 0.5;

export const CAFE_TOPIC_PENALTY = 0.75;

export const CAFE_POPULARITY_POINTS = 2;

export const CAFE_NEUTRAL_PERCENTILE = 0.5;

export const CAFE_MIDRANK_SHARE = 0.5;

export const CAFE_AUTHOR_MINIMUM = 3;

export const CAFE_PEER_POINTS = 0.5;

export const CAFE_PEER_LIMIT = 2;

export const CAFE_DEFAULT_SUBSTANCE = 0.5;

export const CAFE_DEFAULT_EDITORIAL = 0;

export const cafeSubstancePoints = {
  announcement: 0.25,
  demo: 0.75,
  proof: 1,
  release: 0.5,
  technique: 1,
  tool: 0.5,
} as const satisfies Record<(typeof CafeInterest.Type)["substance"], number>;

const dayStart = (date: IsoDateValue) =>
  DateTime.toEpochMillis(DateTime.makeUnsafe(`${date}T00:00:00Z`));

const freshestDate = (item: CafeNewsItemValue) =>
  Math.max(
    dayStart(item.date),
    dayStart(item.engagement?.pushedAt ?? item.date)
  );

export const cafeDomain = (url: string) => new URL(url).hostname;

const authorKey = (item: CafeNewsItemValue) =>
  (item.author.x ?? item.author.github ?? cafeDomain(item.url)).toLowerCase();

const logCount = (value = 0) => Math.log10(1 + value);

const rawPopularity = (item: CafeNewsItemValue) => {
  if (item.kind === "thread") {
    return (
      logCount(item.engagement.likes) +
      logCount(item.engagement.replies) +
      logCount(item.engagement.participants) +
      logCount(item.engagement.bookmarks)
    );
  }

  if (item.kind === "video") {
    return logCount(item.engagement?.views);
  }

  if (item.kind === "launch") {
    return logCount(item.engagement?.stars);
  }

  return null;
};

const percentile = (value: number, pool: readonly number[]) =>
  Arr.reduce(pool, 0, (rank, candidate) => {
    if (candidate < value) {
      return rank + 1;
    }

    return candidate === value ? rank + CAFE_MIDRANK_SHARE : rank;
  }) / pool.length;

const peerHandles = (people: readonly Pick<CafePersonValue, "handles">[]) =>
  new Set(
    people.flatMap((person) =>
      person.handles
        .filter((handle) => handle.kind === "x")
        .map((handle) => handle.handle.toLowerCase())
    )
  );

const peerPoints = (item: CafeNewsItemValue, allStars: ReadonlySet<string>) => {
  const peers = new Set(
    (item.engagement?.peers ?? []).map((handle) => handle.toLowerCase())
  );

  if (item.kind === "thread") {
    for (const reply of item.topReplies) {
      const handle = reply.x.toLowerCase();

      if (allStars.has(handle)) {
        peers.add(handle);
      }
    }
  }

  if (item.author.x !== null) {
    peers.delete(item.author.x.toLowerCase());
  }

  return CAFE_PEER_POINTS * Math.min(peers.size, CAFE_PEER_LIMIT);
};

const editorial = (item: CafeNewsItemValue) =>
  item.interest?.editorial ?? CAFE_DEFAULT_EDITORIAL;

const topic = (item: CafeNewsItemValue) => item.interest?.topic ?? item.url;

const scoreCafeNews = (
  items: readonly CafeNewsItemValue[],
  now: IsoDateValue,
  people: readonly Pick<CafePersonValue, "handles">[]
): readonly RankedCafeNewsItemValue[] => {
  const rankedAt = dayStart(now);
  const allStars = peerHandles(people);

  const pools = Arr.groupBy(
    items.flatMap((item) => {
      const value = rawPopularity(item);

      return value === null
        ? []
        : [{ author: authorKey(item), kind: item.kind, value }];
    }),
    (row) => row.kind
  );

  return items.map((item) => {
    const value = rawPopularity(item);
    const pool = pools[item.kind] ?? [];
    const author = authorKey(item);
    const own = pool.filter((row) => row.author === author);

    const field =
      value === null
        ? CAFE_NEUTRAL_PERCENTILE
        : percentile(
            value,
            pool.map((row) => row.value)
          );

    const popularity =
      value !== null && own.length >= CAFE_AUTHOR_MINIMUM
        ? (field +
            percentile(
              value,
              own.map((row) => row.value)
            )) /
          2
        : field;

    const substance =
      item.interest === undefined
        ? CAFE_DEFAULT_SUBSTANCE
        : cafeSubstancePoints[item.interest.substance];

    const ageDays = Math.max(0, (rankedAt - freshestDate(item)) / 86_400_000);

    return {
      item,
      score:
        CAFE_POPULARITY_POINTS * popularity +
        substance +
        editorial(item) +
        peerPoints(item, allStars) -
        ageDays / CAFE_AGE_DAYS_PER_POINT,
      why: item.interest?.why ?? null,
    };
  });
};

const newestFirst = Order.combine(
  Order.flip(
    Order.mapInput(Order.String, (item: CafeNewsItemValue) => item.date)
  ),
  Order.mapInput(Order.String, (item: CafeNewsItemValue) => item.url)
);

const byAdjustedScore = Order.combine(
  Order.flip(
    Order.mapInput(
      Order.Number,
      (entry: RankedCafeNewsItemValue) => entry.score
    )
  ),
  Order.mapInput(newestFirst, (entry: RankedCafeNewsItemValue) => entry.item)
);

export const sortCafeNewsNewest = (
  items: readonly CafeNewsItemValue[]
): readonly CafeNewsItemValue[] => Arr.sort(items, newestFirst);

const rankScoredCafeNews = (
  scored: readonly RankedCafeNewsItemValue[]
): readonly RankedCafeNewsItemValue[] => {
  const ranked: RankedCafeNewsItemValue[] = [];

  let pending = scored.map((entry) => ({
    author: authorKey(entry.item),
    base: entry.score,
    diversity: 0,
    entry,
    site: cafeDomain(entry.item.url),
    topic: topic(entry.item),
    topicRepeats: 0,
  }));

  while (pending.length > 0) {
    const [next, ...rest] = pending.toSorted((a, b) =>
      byAdjustedScore(a.entry, b.entry)
    );

    if (next === undefined) {
      break;
    }

    ranked.push(next.entry);
    pending = rest.map((row) => {
      const diversity =
        row.diversity +
        Number(row.author === next.author || row.site === next.site);

      const topicRepeats =
        row.topicRepeats +
        Number(
          row.topic === next.topic &&
            editorial(next.entry.item) >= editorial(row.entry.item)
        );

      return {
        ...row,
        diversity,
        entry: {
          ...row.entry,
          score:
            row.base -
            (CAFE_DIVERSITY_PENALTY * diversity +
              CAFE_TOPIC_PENALTY * topicRepeats),
        },
        topicRepeats,
      };
    });
  }

  return ranked;
};

export const rankCafeNews = (
  items: readonly CafeNewsItemValue[],
  now: IsoDateValue,
  people: readonly Pick<CafePersonValue, "handles">[] = []
): readonly RankedCafeNewsItemValue[] =>
  rankScoredCafeNews(scoreCafeNews(items, now, people));

export const cafeRankedAt = (
  news: readonly CafeNewsItemValue[],
  projects: readonly CafeProjectValue[]
): Option.Option<IsoDateValue> =>
  Arr.match(
    [
      ...news.map((item) => item.date),
      ...projects.map((project) => project.date),
    ],
    {
      onEmpty: () => Option.none(),
      onNonEmpty: (dates) => Option.some(Arr.max(dates, Order.String)),
    }
  );

export const verifiedLetters = (
  project: Pick<CafeProjectValue, "stack">
): readonly CafeLetterValue[] =>
  cafeLetters.filter((letter) => project.stack[letter] !== null);

export const filterCafeProjects = (
  projects: readonly CafeProjectValue[],
  letters: readonly CafeLetterValue[]
): readonly CafeProjectValue[] =>
  projects.filter((project) =>
    letters.every((letter) => project.stack[letter] !== null)
  );

const byUpdated = Order.combine(
  Order.flip(
    Order.mapInput(Order.String, (project: CafeProjectValue) => project.date)
  ),
  Order.mapInput(Order.String, (project: CafeProjectValue) => project.url)
);

const byStars = Order.combine(
  Order.flip(
    Order.mapInput(
      Order.Number,
      (project: CafeProjectValue) => project.stars ?? -1
    )
  ),
  byUpdated
);

export const sortCafeProjects = (
  projects: readonly CafeProjectValue[],
  sort: typeof CafeProjectSort.Type
): readonly CafeProjectValue[] =>
  Arr.sort(projects, sort === "stars" ? byStars : byUpdated);

const Limit = Schema.optional(
  Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 1 }))
);

export const CafeNewsQuery = Schema.Struct({
  kind: Schema.optional(CafeNewsKind),
  limit: Limit,
  sort: Schema.optional(CafeNewsSort),
});

export const CafeNewsList = Schema.Struct({
  items: Schema.Array(RankedCafeNewsItem),
  rankedAt: IsoDate,
  sort: CafeNewsSort,
  total: Schema.Int,
});

export const CafeProjectQuery = Schema.Struct({
  letters: Schema.optional(Schema.Array(CafeLetter)),
  limit: Limit,
  sort: Schema.optional(CafeProjectSort),
});

export const CafeProjectList = Schema.Struct({
  projects: Schema.Array(CafeProject),
  total: Schema.Int,
});

export const CafeRepoStars = Schema.Struct({
  repo: RepoName,
  stars: Count,
  ...verified,
});

export const CafePersonSummary = Schema.Struct({
  avatar: AvatarPath,
  handles: Schema.Array(CafeHandle),
  id: PersonId,
  kind: CafePersonKind,
  name: OneLine,
  packages: Schema.Array(PackageName),
  repos: Schema.Array(CafeRepoStars),
  route: Schema.String,
  summary: CafeFact,
  topics: Schema.Array(CafeTopic),
});

export const CafeProfile = Schema.Struct({
  ...CafePerson.fields,
  newsRows: Schema.Array(CafeNewsItem),
  packages: Schema.Array(PackageName),
  route: Schema.String,
});

export type CafeProfileValue = typeof CafeProfile.Type;

export const CafePeopleQuery = Schema.Struct({
  kind: Schema.optional(CafePersonKind),
  limit: Limit,
});

export const CafePeopleList = Schema.Struct({
  people: Schema.Array(CafePersonSummary),
  total: Schema.Int,
});

export const CafePeopleSearchQuery = Schema.Struct({
  limit: Limit,
  query: Schema.String.check(Schema.isNonEmpty()),
});

export const CafePeopleMatches = Schema.Struct({
  matches: Schema.Array(
    Schema.Struct({
      matched: Schema.Array(Schema.String),
      person: CafePersonSummary,
    })
  ),
  total: Schema.Int,
});

export const CafeEvidence = Schema.Struct({
  repo: Schema.NullOr(RepoName),
  term: Schema.String,
  value: Schema.String,
  via: Schema.Literals(["topic", "package"]),
  ...verified,
});

export const CafePeopleForQuery = Schema.Struct({
  terms: Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(
    Schema.isMinLength(1)
  ),
});

export const CafePeopleForList = Schema.Struct({
  people: Schema.Array(
    Schema.Struct({
      evidence: Schema.Array(CafeEvidence),
      person: CafePersonSummary,
    })
  ),
  terms: Schema.Array(Schema.String),
  total: Schema.Int,
});

const defaultLimit = 30;

export const selectCafeNews = (
  data: CafeDataValue,
  query: typeof CafeNewsQuery.Type
): typeof CafeNewsList.Type => {
  const sort = query.sort ?? "rank";
  const scored = scoreCafeNews(data.news, data.rankedAt, data.people);

  const ordered =
    sort === "rank"
      ? rankScoredCafeNews(scored)
      : Arr.sort(
          scored,
          Order.mapInput(
            newestFirst,
            (entry: RankedCafeNewsItemValue) => entry.item
          )
        );

  const matching = ordered.filter(
    (entry) => query.kind === undefined || entry.item.kind === query.kind
  );

  return {
    items: matching.slice(0, query.limit ?? defaultLimit),
    rankedAt: data.rankedAt,
    sort,
    total: matching.length,
  };
};

export const selectCafeProjects = (
  data: CafeDataValue,
  query: typeof CafeProjectQuery.Type
): typeof CafeProjectList.Type => {
  const matching = sortCafeProjects(
    filterCafeProjects(data.projects, query.letters ?? []),
    query.sort ?? "updated"
  );

  return {
    projects: matching.slice(0, query.limit ?? defaultLimit),
    total: matching.length,
  };
};

export const githubProfileUrl = (login: string) =>
  `https://github.com/${login}`;

export const xProfileUrl = (handle: string) => `https://x.com/${handle}`;
