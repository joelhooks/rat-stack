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
  likes: Schema.optionalKey(Count),
  participants: Schema.optionalKey(Count),
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

const storyFields = {
  author: CafeAuthor,
  date: IsoDate,
  engagement: Schema.optionalKey(CafeEngagement),
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
});

export type RankedCafeNewsItemValue = typeof RankedCafeNewsItem.Type;

export const CafeData = Schema.Struct({
  news: Schema.Array(CafeNewsItem),
  projects: Schema.Array(CafeProject),
  rankedAt: IsoDate,
});

export type CafeDataValue = typeof CafeData.Type;

export const CAFE_FRESHNESS_HOURS = 72;

export const CAFE_DIVERSITY_PENALTY = 0.5;

export const CafeSignal = Schema.Literals([
  "likes",
  "replies",
  "participants",
  "seen",
  "stars",
  "views",
]);

export type CafeSignalValue = typeof CafeSignal.Type;

export const cafeSignalWeights = {
  likes: 1,
  participants: 1,
  replies: 1,
  seen: 1,
  stars: 1,
  views: 0.5,
} as const satisfies Record<CafeSignalValue, number>;

export const cafeSignals = (
  engagement: CafeEngagementValue | undefined
): Record<CafeSignalValue, number> => ({
  likes: engagement?.likes ?? 0,
  participants: engagement?.participants ?? 0,
  replies: engagement?.replies ?? 0,
  seen: engagement?.seen ?? 0,
  stars: engagement?.stars ?? 0,
  views: engagement?.views ?? 0,
});

const hoursPerMillisecond = 1 / 3_600_000;

const dayStart = (date: IsoDateValue) =>
  DateTime.toEpochMillis(DateTime.makeUnsafe(`${date}T00:00:00Z`));

const freshestDate = (item: CafeNewsItemValue) =>
  Math.max(
    dayStart(item.date),
    item.engagement?.pushedAt === undefined
      ? Number.NEGATIVE_INFINITY
      : dayStart(item.engagement.pushedAt)
  );

export const cafeNewsScore = (
  item: CafeNewsItemValue,
  now: IsoDateValue
): number => {
  const signals = cafeSignals(item.engagement);

  const engagement = Arr.reduce(
    CafeSignal.literals,
    0,
    (total, signal) =>
      total + cafeSignalWeights[signal] * Math.log10(1 + signals[signal])
  );

  const ageHours = Math.max(
    0,
    (dayStart(now) - freshestDate(item)) * hoursPerMillisecond
  );

  return engagement - ageHours / CAFE_FRESHNESS_HOURS;
};

export const cafeDomain = (url: string) => new URL(url).hostname;

const authorKey = (item: CafeNewsItemValue) =>
  item.author.x ?? item.author.github ?? cafeDomain(item.url);

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

export const rankCafeNews = (
  items: readonly CafeNewsItemValue[],
  now: IsoDateValue
): readonly RankedCafeNewsItemValue[] => {
  const pick = (
    remaining: readonly RankedCafeNewsItemValue[],
    ranked: readonly RankedCafeNewsItemValue[]
  ): readonly RankedCafeNewsItemValue[] => {
    const repeats = (entry: RankedCafeNewsItemValue) =>
      ranked.filter(
        (placed) =>
          authorKey(placed.item) === authorKey(entry.item) ||
          cafeDomain(placed.item.url) === cafeDomain(entry.item.url)
      ).length;

    return Option.match(
      Arr.head(
        Arr.sort(
          remaining.map((entry) => ({
            ...entry,
            score: entry.score - CAFE_DIVERSITY_PENALTY * repeats(entry),
          })),
          byAdjustedScore
        )
      ),
      {
        onNone: () => ranked,
        onSome: (next) =>
          pick(
            remaining.filter((entry) => entry.item.url !== next.item.url),
            [...ranked, next]
          ),
      }
    );
  };

  return pick(
    items.map((item) => ({ item, score: cafeNewsScore(item, now) })),
    []
  );
};

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

export const CafeNewsQuery = Schema.Struct({
  kind: Schema.optional(CafeNewsKind),
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 1 }))
  ),
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
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 1 }))
  ),
  sort: Schema.optional(CafeProjectSort),
});

export const CafeProjectList = Schema.Struct({
  projects: Schema.Array(CafeProject),
  total: Schema.Int,
});

const defaultLimit = 30;

export const selectCafeNews = (
  data: CafeDataValue,
  query: typeof CafeNewsQuery.Type
): typeof CafeNewsList.Type => {
  const sort = query.sort ?? "rank";
  const ranked = rankCafeNews(data.news, data.rankedAt);

  const ordered =
    sort === "rank"
      ? ranked
      : sortCafeNewsNewest(data.news).map((item) => ({
          item,
          score: cafeNewsScore(item, data.rankedAt),
        }));

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
