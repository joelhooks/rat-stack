import * as content from "../src/content.js";
import { searchContent as searchResources } from "../src/search-content.js";
import { catalog, contentResources } from "./generated-content.js";

export {
  a2aAgentCard,
  agentSkillPath,
  apiCatalog,
  ardManifest,
  authMarkdown,
  linkHeader,
  linkHeaderForPage,
  mcpServerCard,
  mcpToolsListExample,
  mcpVersionText,
  ogImagePath,
  robotsText,
  staticAssetGeneration,
  staticContentVersion,
  tokenmaxxMarkdown,
} from "../src/content.js";

export { contentResources } from "./generated-content.js";

export const lawResources = contentResources.filter(
  (resource) => resource.kind === "law"
);

export const loreResources = contentResources.filter(
  (resource) => resource.kind === "lore"
);

export const skills = contentResources.filter(
  (resource) => resource.kind === "skill"
);

export const publicPaths = content.publicPaths(catalog);

export const markdownDocument = (origin: string) =>
  content.markdownDocument(origin, catalog);

export const llmsText = (origin: string) => content.llmsText(origin, catalog);

export const llmsFullText = (origin: string) =>
  content.llmsFullText(origin, catalog, contentResources);

export const agentSkillsIndex = () => content.agentSkillsIndex(catalog);

export const sitemapXml = (origin: string) =>
  content.sitemapXml(origin, catalog);

export const glossaryIndex = () => content.glossaryIndex(catalog);

export const skillIndex = () => content.skillIndex(catalog);

export const loreIndex = () => content.loreIndex(catalog);

export const systemsIndex = () => content.systemsIndex(catalog);

export const searchContent = (query: string, limit?: number) =>
  searchResources(contentResources, query, limit);

export const readContent = (id: string) =>
  contentResources.find(
    (resource) => resource.id === id || resource.routePath === id
  );
