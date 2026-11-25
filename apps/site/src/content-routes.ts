import type { ContentCatalogData } from "./content-data.js";

export const agentSkillPath = (name: string) =>
  `/.well-known/agent-skills/${name}/SKILL.md` as const;

export const publicPaths = (catalog: Pick<ContentCatalogData, "resources">) =>
  [
    "/",
    "/auth.md",
    "/llms.txt",
    "/llms-full.txt",
    "/openapi.json",
    "/robots.txt",
    "/sitemap.xml",
    "/tokenmaxx",
    "/skills",
    "/lore",
    "/systems",
    "/glossary",
    "/.well-known/agent-card.json",
    "/.well-known/agent.json",
    "/.well-known/agent-skills/index.json",
    "/.well-known/ai-catalog.json",
    "/.well-known/api-catalog",
    "/.well-known/mcp.json",
    ...catalog.resources.flatMap((resource) =>
      resource.kind === "skill"
        ? [resource.routePath, agentSkillPath(resource.name)]
        : [resource.routePath]
    ),
  ] as const;

export const sitemapPaths = (pageRoutes: readonly string[]) =>
  [...new Set([...pageRoutes, "/tokenmaxx"])].filter(
    (path) => path !== "/log.md" && !path.startsWith("/tokenmaxx/")
  );
