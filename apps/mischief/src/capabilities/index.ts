import { toExecuteCapability } from "@rat-stack/capability/code-mode";
import { getPrompt, listPrompts } from "@rat-stack/core";
import { joinInterest } from "@rat-stack/core/join-interest";
import { feedbackCapabilities } from "@rat-stack/learn/feedback";
import { Layer } from "effect";

import { ContentStore } from "../content-store.js";
import { promptLibraryLayer } from "../prompt-library.js";
import { learnCapabilities, learnLayer } from "./learn.js";
import { backlinks, mentions, neighbors, path } from "./lore.js";
import { read } from "./read.js";
import { search } from "./search.js";

export { read } from "./read.js";

export { backlinks, mentions, neighbors, path } from "./lore.js";

export {
  BacklinksOutput,
  LoreEdge,
  LoreEdgeKind,
  LoreGroup,
  LoreNode,
  LorePageReference,
  LorePathOutput,
  MentionsOutput,
  NeighborsOutput,
  NoPath,
  UnknownPage,
  ReadOutput,
  ResourceNotFound,
  SearchMatch,
  SearchOutput,
} from "@rat-stack/core/contracts";

export { search } from "./search.js";

export const readerCapabilities = [
  listPrompts,
  getPrompt,
  search,
  read,
  backlinks,
  neighbors,
  mentions,
  path,
] as const;

export const contentCapabilities = [
  ...readerCapabilities,
  ...learnCapabilities,
] as const;

export const contentLayer = Layer.merge(learnLayer, promptLibraryLayer).pipe(
  Layer.provideMerge(ContentStore.layer)
);

const generatedExecuteProjection = toExecuteCapability(contentCapabilities);

const executeDescription = [
  generatedExecuteProjection.capability.contract.description,
  "",
  "The program is the body of an async function: `return` sets the result, and `console.log` output is returned in `logs`. Imports, exports, and `fetch` are unavailable; call tools as `await tools.search({...})` or `await tools.read({...})`.",
  "Pass the program in the `code` argument. Example:",
  "",
  "```js",
  'const found = await tools.search({ query: "capability", limit: 1 });',
  "return await tools.read({ id: found.matches[0].id });",
  "```",
].join("\n");

export const execute = {
  ...generatedExecuteProjection.capability,
  contract: {
    ...generatedExecuteProjection.capability.contract,
    description: executeDescription,
  },
};

export const executeProjection = {
  ...generatedExecuteProjection,
  capability: execute,
};

export const capabilities = [
  ...contentCapabilities,
  execute,
  joinInterest,
] as const;

export const feedbackExecuteProjection = toExecuteCapability([
  ...contentCapabilities,
  ...feedbackCapabilities,
] as const);

export const authenticatedCapabilities = [
  ...contentCapabilities,
  ...feedbackCapabilities,
  feedbackExecuteProjection.capability,
  joinInterest,
] as const;
