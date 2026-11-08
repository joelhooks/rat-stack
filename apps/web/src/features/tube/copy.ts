import type { TubeThemeValue, TubeTierValue } from "../../client/tube/data.js";

export const tubeRoutePath = "/tube";

export const tubeDataPath = ".brain/data/tube.json";

export const tubeCopy = {
  description:
    "Curated videos for learning Effect, Alchemy, XState, TypeScript, agents and MCP, Cloudflare, and systems thinking, ranked S to F with a short take on each.",
  disclosure:
    "Thumbnails load from YouTube's image host. A video plays from youtube-nocookie.com only after you press its play button. Every title links to the video on youtube.com.",
  heading: "Ratstack Tube",
  intro:
    "Videos worth your time if you are learning this stack, most of them by the people who build the tools. Each one comes with a short take on what you learn from it.",
  picksHeading: "Start here",
  picksIntro: "The S tier, in order:",
  playLabel: "Play here",
  rankRule:
    "Tiers run from S to F by how useful the video is to someone learning this stack. Within a tier, order is editorial. Titles, channels, durations and dates come from YouTube and carry the date we checked them.",
  themesLabel: "Themes",
};

export const themeCopy = {
  agents: {
    blurb:
      "How agents work, why tools and skills matter, and where MCP and code mode fit.",
    name: "Agents and MCP",
  },
  alchemy: {
    blurb:
      "Infrastructure as Effects: cloud resources declared in the same TypeScript program as the code that uses them.",
    name: "Alchemy and infrastructure as code",
  },
  cloudflare: {
    blurb:
      "Workers, Durable Objects, Queues and Workflows, where this stack runs.",
    name: "Cloudflare",
  },
  effect: {
    blurb:
      "Typed failures, services and layers, structured concurrency, Schema, and where Effect is heading.",
    name: "Effect",
  },
  systems: {
    blurb:
      "Simplicity, values, specifications, property tests and failure: the ideas under the fence.",
    name: "Systems thinking",
  },
  typescript: {
    blurb:
      "The language, its type system, and the native compiler in TypeScript 7.",
    name: "TypeScript",
  },
  xstate: {
    blurb: "Finite states, statecharts and actors for lifecycles you can see.",
    name: "XState and state machines",
  },
} as const satisfies Record<
  TubeThemeValue,
  { readonly blurb: string; readonly name: string }
>;

export const tierLabel = (tier: TubeTierValue) => `${tier} tier`;
