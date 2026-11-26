import {
  CAFE_AGE_DAYS_PER_POINT,
  CAFE_AUTHOR_MINIMUM,
  CAFE_DEFAULT_EDITORIAL,
  CAFE_DEFAULT_SUBSTANCE,
  CAFE_DIVERSITY_PENALTY,
  CAFE_EDITORIAL_MAX,
  CAFE_MIDRANK_SHARE,
  CAFE_NEUTRAL_PERCENTILE,
  CAFE_PEER_LIMIT,
  CAFE_PEER_POINTS,
  CAFE_POPULARITY_POINTS,
  CAFE_TOPIC_PENALTY,
  cafeSubstancePoints,
} from "@rat-stack/core/contracts";
import type {
  CafeHandleKind,
  CafeLetterValue,
  CafeNewsKindValue,
} from "@rat-stack/core/contracts";

export const letterNames = {
  alchemy: "Alchemy",
  cloudflare: "Cloudflare",
  effect: "Effect",
  foldkit: "Foldkit",
} as const satisfies Record<CafeLetterValue, string>;

export const newsKindLabels = {
  launch: "launch",
  post: "post",
  release: "release",
  thread: "thread",
  video: "video",
} as const satisfies Record<CafeNewsKindValue, string>;

export const cafeSubmissionPrompt =
  "Know a project or story about the stack? Ask your agent to suggest it.";

export const newsCopy = {
  description:
    "News from people who build with Cloudflare, Alchemy, Foldkit and Effect.",
  feedLabel: "Atom feed",
  heading: "Ratstack news",
  intro:
    "News from people who build with Cloudflare, Alchemy, Foldkit and Effect. The ratstack desk agent picks and checks entries from public sources each day.",
  priorArtLead: "Prior art: ",
  repliesLabel: "Top replies",
  sortHeading: "How this list is sorted",
};

export const shownReplies = 3;

export const sortSignalsLead =
  "Interest adds up popularity, substance, editorial judgment and peer engagement, then subtracts age.";

export const sortSignals = [
  `Popularity contributes up to ${CAFE_POPULARITY_POINTS} points. For X threads, add log10(1 + count) for each of likes, replies, participants and bookmarks. For videos, use log10(1 + views). For launches, use log10(1 + stars). Missing counts are zero.`,
  `Compare that total with entries on the same platform: count the entries below it and ${CAFE_MIDRANK_SHARE} of those tied with it, then divide by the number of entries. If the author has at least ${CAFE_AUTHOR_MINIMUM} entries on that platform, average this result with the same calculation over that author's entries. Multiply the result by ${CAFE_POPULARITY_POINTS}.`,
  `Releases and posts get a neutral percentile of ${CAFE_NEUTRAL_PERCENTILE}. Repo stars measure the repo, not the release.`,
  `Substance: proofs and techniques get ${cafeSubstancePoints.proof} point, demos get ${cafeSubstancePoints.demo}, releases and tools get ${cafeSubstancePoints.release}, and announcements get ${cafeSubstancePoints.announcement}.`,
  `Editorial: from ${CAFE_DEFAULT_EDITORIAL} to ${CAFE_EDITORIAL_MAX} points. ${CAFE_EDITORIAL_MAX} is reserved for news that changes how people build on the stack.`,
  `Peers: ${CAFE_PEER_POINTS} points each for up to ${CAFE_PEER_LIMIT} distinct All Stars who replied, quoted or shared a link, including All Stars in the top replies. The author does not count.`,
  `Age subtracts one point per ${CAFE_AGE_DAYS_PER_POINT} days since the entry date or last push, whichever is later. Future dates count as zero days old.`,
  `Unrated entries get ${CAFE_DEFAULT_SUBSTANCE} substance points, ${CAFE_DEFAULT_EDITORIAL} editorial points and a topic of their own.`,
] as const;

export const sortRulesLead =
  "We place the highest remaining score first and recalculate after each placement:";

export const sortRules = [
  `An entry loses ${CAFE_DIVERSITY_PENALTY} points for each higher entry by the same author or from the same site. We identify the author by X handle, then GitHub login, then the site's hostname.`,
  `An entry loses ${CAFE_TOPIC_PENALTY} points for each higher entry on the same topic with an equal or higher editorial score.`,
  "Equal scores go to the newer entry, then to the earlier URL in alphabetical order.",
] as const;

export const sortSources = [
  {
    href: "https://medium.com/hacking-and-gonzo/how-reddit-ranking-algorithms-work-ef111e33d0d9",
    label: "Reddit hot ranking",
  },
  {
    href: "https://www.righto.com/2013/11/how-hacker-news-ranking-really-works.html",
    label: "Hacker News gravity and penalties",
  },
  {
    href: "https://herman.bearblog.dev/a-better-ranking-algorithm/",
    label: "Bear Blog ranking for a small site",
  },
] as const;

export const directoryCopy = {
  clearLabel: "Show all projects",
  description:
    "Reviewed projects built with Cloudflare, Alchemy, Foldkit and Effect, with stack evidence.",
  filterLegend: "Show projects that use",
  heading: "Ratstack directory",
  intro:
    "Projects built with Cloudflare, Alchemy, Foldkit and Effect. A letter badge appears only when the repository shows evidence for it.",
};

export const projectCount = (count: number) =>
  `${count} ${count === 1 ? "project" : "projects"}`;

export const threadCounts = (replies: number, people: number) =>
  `${replies} ${replies === 1 ? "reply" : "replies"} · ${people} ${people === 1 ? "person" : "people"}`;

export const allStarsCopy = {
  channelsHeading: "Channels",
  description:
    "People and channels whose public work builds with Cloudflare, Alchemy, Foldkit and Effect. Every fact links to its source.",
  entryRule:
    "A person or channel enters through a /news row, contributions to a pinned stack package, code on the stack that rat-stack vendors or credits, or sourced public work built on or teaching the stack.",
  feedLabel: "Atom feed",
  heading: "Ratstack all stars",
  intro:
    "People and channels with a /news row, contributions to pinned stack packages, code on the stack that rat-stack vendors or credits, or sourced public work on the stack. Every fact links to its source and the date we checked it.",
  newsHeading: "On /news",
  noNews: "No /news rows yet.",
  peopleHeading: "People",
  profileLabel: "all stars profile",
};

export const allStarsTools =
  "Agents can call `listPeople`, `readPerson`, `searchPeople`, `listChannels` and `peopleFor` over MCP, HTTP or code mode.";

export const removalPromise = "A removal ships with the next site update.";

export const removalIssueUrl = (id: string | null) =>
  `https://github.com/joelhooks/rat-stack/issues/new?title=${encodeURIComponent(id === null ? "Remove an all stars profile" : `Remove all stars profile: ${id}`)}`;

export const removalLine = (id: string | null) =>
  `To be removed from this page, [open an issue](${removalIssueUrl(id)}) in joelhooks/rat-stack. ${removalPromise}`;

export const handleLabels = {
  blog: "Blog",
  github: "GitHub",
  site: "Site",
  x: "X",
  youtube: "YouTube",
} as const satisfies Record<typeof CafeHandleKind.Type, string>;
