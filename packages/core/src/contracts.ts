import { defineContract } from "@rat-stack/capability/contract";
import { Schema } from "effect";

import { AssetReadError } from "./asset-read-error.js";
import {
  CafeNewsList,
  CafeNewsQuery,
  CafeProjectList,
  CafeProjectQuery,
} from "./cafe.js";
import { NoPath } from "./no-path.js";
import { FileStatsError, FileStatsSchema } from "./stats.js";
import { UnknownPage } from "./unknown-page.js";
import { UnknownPrompt } from "./unknown-prompt.js";

export { getFlagContract, listFlagsContract } from "./flag-contracts.js";

export { UnknownPrompt } from "./unknown-prompt.js";

export { AssetReadError } from "./asset-read-error.js";

export {
  CAFE_DIVERSITY_PENALTY,
  CAFE_FRESHNESS_HOURS,
  CafeAuthor,
  CafeData,
  CafeEngagement,
  CafeLetter,
  CafeNewsItem,
  CafeNewsKind,
  CafeNewsList,
  CafeNewsQuery,
  CafeNewsSort,
  CafeProject,
  CafeProjectList,
  CafeProjectQuery,
  CafeProjectSort,
  CafeReply,
  CafeSignal,
  CafeStackEvidence,
  CafeStory,
  CafeThread,
  GithubLogin,
  HttpsUrl,
  IsoDate,
  OneLine,
  RankedCafeNewsItem,
  RepoName,
  ReplyText,
  XHandle,
  XStatusUrl,
  cafeDomain,
  cafeLetterInitial,
  cafeLetters,
  cafeNewsScore,
  cafeRankedAt,
  cafeSignalWeights,
  cafeSignals,
  filterCafeProjects,
  githubProfileUrl,
  rankCafeNews,
  selectCafeNews,
  selectCafeProjects,
  sortCafeNewsNewest,
  sortCafeProjects,
  verifiedLetters,
  xProfileUrl,
} from "./cafe.js";

export type {
  CafeDataValue,
  CafeEngagementValue,
  CafeLetterValue,
  CafeNewsItemValue,
  CafeNewsKindValue,
  CafeProjectValue,
  CafeSignalValue,
  IsoDateValue,
  RankedCafeNewsItemValue,
} from "./cafe.js";

export {
  CardSchema,
  ConceptProgressSchema,
  LearnContextSchema,
  LearnDepthSchema,
  LearnEventSchema,
  LearnPreferencesSchema,
  ProgressSchema,
} from "./learn-model.js";

export {
  learnCardContract,
  learnDeckContract,
  learnNextContract,
  learnPreferencesContract,
  learnRecordContract,
  learnSetPreferencesContract,
} from "./learn-contracts.js";

export {
  learnFeedbackContract,
  learnFeedbackPollContract,
  learnFeedbackStartContract,
} from "./learn-feedback.js";

export { NoPath } from "./no-path.js";

export { UnknownPage } from "./unknown-page.js";

const ContentKind = Schema.Literals(["law", "skill", "lore", "prompt"]);

export const SearchMatch = Schema.Struct({
  description: Schema.String,
  digest: Schema.String,
  excerpt: Schema.String,
  id: Schema.String,
  kind: ContentKind,
  routePath: Schema.String,
  score: Schema.Finite,
  title: Schema.String,
});

export const SearchOutput = Schema.Struct({
  matches: Schema.Array(SearchMatch),
  total: Schema.Finite,
});

export const ReadOutput = Schema.Struct({
  description: Schema.String,
  digest: Schema.String,
  id: Schema.String,
  kind: ContentKind,
  routePath: Schema.String,
  sourcePath: Schema.String,
  text: Schema.String,
  title: Schema.String,
});

export class ResourceNotFound extends Schema.TaggedError<ResourceNotFound>()(
  "ResourceNotFound",
  {
    id: Schema.String,
    message: Schema.String,
  }
) {}

export const LoreGroup = Schema.Literals([
  "idea",
  "concept",
  "source",
  "person",
  "system",
]);

export const LorePageReference = Schema.Struct({
  group: Schema.String,
  id: Schema.String,
  title: Schema.String,
  url: Schema.String,
});

export const LoreNode = Schema.Struct({
  description: Schema.String,
  group: LoreGroup,
  id: Schema.String,
  slug: Schema.String,
  terms: Schema.Array(Schema.String),
  title: Schema.String,
  url: Schema.String,
});

export const LoreEdgeKind = Schema.Literals(["link", "citation", "mention"]);

export const LoreEdge = Schema.Struct({
  excerpt: Schema.optional(Schema.String),
  from: LorePageReference,
  kind: LoreEdgeKind,
  to: LorePageReference,
});

export const BacklinksOutput = Schema.Struct({
  backlinks: Schema.Array(
    Schema.Struct({
      kind: LoreEdgeKind,
      page: LorePageReference,
    })
  ),
});

export const NeighborsOutput = Schema.Struct({
  neighbors: Schema.Array(
    Schema.Struct({
      distance: Schema.Finite,
      node: LoreNode,
    })
  ),
});

export const MentionsOutput = Schema.Struct({
  mentions: Schema.Array(
    Schema.Struct({
      excerpt: Schema.String,
      page: LorePageReference,
    })
  ),
});

export const LorePathOutput = Schema.Struct({
  edges: Schema.Array(LoreEdge),
  nodes: Schema.Array(LoreNode),
});

export const backlinksContract = defineContract("backlinks", {
  annotations: { idempotent: true, readOnly: true },
  description: "List pages that link to or mention one lore page",
  failure: Schema.Union([UnknownPage, AssetReadError]),
  input: Schema.Struct({ slug: Schema.String }),
  output: BacklinksOutput,
});

export const neighborsContract = defineContract("neighbors", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "List lore pages within one or two incoming or outgoing graph hops",
  failure: Schema.Union([UnknownPage, AssetReadError]),
  input: Schema.Struct({
    depth: Schema.Literals([1, 2]),
    slug: Schema.String,
  }),
  output: NeighborsOutput,
});

export const mentionsContract = defineContract("mentions", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "Find unlinked mentions of one lore page and show their excerpts",
  failure: Schema.Union([UnknownPage, AssetReadError]),
  input: Schema.Struct({ slug: Schema.String }),
  output: MentionsOutput,
});

export const pathContract = defineContract("path", {
  annotations: { idempotent: true, readOnly: true },
  description: "Find the shortest undirected chain between two lore pages",
  failure: Schema.Union([UnknownPage, NoPath, AssetReadError]),
  input: Schema.Struct({ from: Schema.String, to: Schema.String }),
  output: LorePathOutput,
});

export const inspectFileContract = defineContract("inspectFile", {
  annotations: { idempotent: true, readOnly: true },
  description: "Count bytes, characters, words, and lines in a file",
  failure: FileStatsError,
  input: Schema.Struct({
    path: Schema.String.annotate({ description: "File to inspect" }),
  }),
  output: FileStatsSchema,
});

export const PromptSlug = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
);

export const PromptSummary = Schema.Struct({
  credit: Schema.String,
  description: Schema.String.check(Schema.isPattern(/\S/u)),
  slug: PromptSlug,
  title: Schema.String.check(Schema.isPattern(/\S/u)),
});

export const Prompt = Schema.Struct({
  ...PromptSummary.fields,
  body: Schema.String.check(Schema.isPattern(/\S/u)),
});

export const listPromptsContract = defineContract("listPrompts", {
  annotations: { idempotent: true, readOnly: true },
  description: "List copyable rat-stack agent prompts",
  failure: AssetReadError,
  input: Schema.Struct({}),
  output: Schema.Struct({ prompts: Schema.Array(PromptSummary) }),
});

export const getPromptContract = defineContract("getPrompt", {
  annotations: { idempotent: true, readOnly: true },
  description: "Read one complete rat-stack agent prompt by slug",
  failure: Schema.Union([UnknownPrompt, AssetReadError]),
  input: Schema.Struct({ slug: PromptSlug }),
  output: Prompt,
});

export const listCafeNewsContract = defineContract("listCafeNews", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "List reviewed CAFE stack news: Cloudflare, Alchemy, Foldkit and Effect releases, posts, videos, launches and X threads. Sort by rank (engagement signals with a freshness decay) or newest, and filter by kind.",
  failure: AssetReadError,
  input: CafeNewsQuery,
  output: CafeNewsList,
});

export const listCafeProjectsContract = defineContract("listCafeProjects", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "List reviewed projects built on the CAFE stack, with per-letter stack evidence. Filter to projects that use every given letter and sort by last update or stars.",
  failure: AssetReadError,
  input: CafeProjectQuery,
  output: CafeProjectList,
});

export const searchContract = defineContract("search", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "Search rat-stack repository law and skills. Returns stable resource ids for read.",
  failure: AssetReadError,
  input: Schema.Struct({
    limit: Schema.optional(Schema.Finite),
    query: Schema.String,
  }),
  output: SearchOutput,
});

export const readContract = defineContract("read", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "Read one exact rat-stack law or skill document by the resource id returned from search.",
  failure: Schema.Union([ResourceNotFound, AssetReadError]),
  input: Schema.Struct({ id: Schema.String }),
  output: ReadOutput,
});
