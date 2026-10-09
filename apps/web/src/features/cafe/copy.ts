import {
  CAFE_DIVERSITY_PENALTY,
  CAFE_FRESHNESS_HOURS,
  cafeSignalWeights,
} from "@rat-stack/core/contracts";
import type {
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

export const newsCopy = {
  description:
    "Reviewed news from people who build with Cloudflare, Alchemy, Foldkit and Effect.",
  feedLabel: "Atom feed",
  heading: "CAFE news",
  intro:
    "News from people who build with Cloudflare, Alchemy, Foldkit and Effect. A person reviews each entry before it appears.",
  repliesLabel: "Top replies",
  sortHeading: "How this list is sorted",
};

export const sortSignalsLead =
  "Each entry gets a score from the signals we already have:";

export const sortSignals = [
  "X likes, replies and the number of people in a thread",
  "GitHub stars, and the date of the last push",
  "YouTube views",
  "The number of independent crawlers that found the entry",
  "The date of the entry",
] as const;

export const sortRulesLead = "The score follows these rules:";

export const sortRules = [
  `Each signal adds its weight times log10(1 + signal). Views weigh ${cafeSignalWeights.views}. Every other signal weighs ${cafeSignalWeights.likes}.`,
  `Age subtracts one point for every ${CAFE_FRESHNESS_HOURS} hours since the entry date or the last push.`,
  `So 10 times the engagement is worth ${CAFE_FRESHNESS_HOURS} hours of freshness.`,
  "A missing signal counts as zero.",
  `After scoring, an entry loses ${CAFE_DIVERSITY_PENALTY} points for each higher entry by the same author or from the same site.`,
  "Equal scores go to the newer entry, then to the earlier URL.",
  "Votes come in a later phase. A Wilson score suits up and down votes, so it waits until we have them.",
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
  heading: "CAFE directory",
  intro:
    "Projects built with Cloudflare, Alchemy, Foldkit and Effect. A letter badge appears only when the repository shows evidence for it.",
};

export const projectCount = (count: number) =>
  `${count} ${count === 1 ? "project" : "projects"}`;

export const threadCounts = (replies: number, people: number) =>
  `${replies} ${replies === 1 ? "reply" : "replies"} · ${people} ${people === 1 ? "person" : "people"}`;
