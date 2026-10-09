import { agentNextActions } from "./agent-guide.js";
import {
  agentPointerMarkdown,
  originToken,
} from "./bundled-content.generated.js";
import type {
  ContentCatalogData as ContentCatalog,
  ContentResource,
  ContentMetadata,
} from "./content-data.js";
import { markdownDiscoveryLinks } from "./content-links.js";
import { canonicalMarkdownLinks } from "./markdown-links.js";

export {
  authMarkdown,
  noVerifyMarkdown,
  staticContentVersion,
  staticAssetGeneration,
  tokenmaxxMarkdown,
} from "./bundled-content.generated.js";

export const ogImagePath = (routePath: string): `/${string}` =>
  `/og${routePath === "/" ? "/home" : routePath}.png`;

const entryList = (resources: readonly (typeof ContentMetadata.Type)[]) =>
  resources
    .map(
      (resource) =>
        `- [${resource.title}](${resource.routePath}) — ${resource.description}`
    )
    .join("\n");

export const markdownDocument = (origin: string, catalog: ContentCatalog) =>
  catalog.homeMarkdownTemplate.replaceAll(originToken, origin);

const mcpToolsListBody = JSON.stringify({
  id: "rat-stack-tools",
  jsonrpc: "2.0",
  method: "tools/list",
  params: {
    _meta: {
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": {
        name: "rat-stack-example",
        version: "0.1.0",
      },
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    },
  },
});

export const mcpToolsListExample = (origin: string) =>
  [
    `curl --request POST '${origin}/mcp' \\`,
    "  --header 'accept: application/json, text/event-stream' \\",
    "  --header 'content-type: application/json' \\",
    "  --header 'MCP-Protocol-Version: 2026-07-28' \\",
    "  --header 'Mcp-Method: tools/list' \\",
    `  --data '${mcpToolsListBody}'`,
  ].join("\n");

export const mcpProtocolVersions = [
  "2026-07-28",
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export const mcpVersionText = (origin: string) =>
  `ratstack.sh MCP supports protocol versions ${mcpProtocolVersions.join(", ")} at ${origin}/mcp.\nProtocol 2026-07-28 is stateless and has no initialize handshake; send the version header, Mcp-Method header, and params._meta shown in the worked tools/list request.\nOlder clients (2025-11-25 back to 2024-11-05) send initialize as usual and get a session of their own.\nSee ${origin}/llms.txt for the complete curl example.\n`;

export const llmsText = (
  origin: string,
  catalog: ContentCatalog
) => `# ratstack.sh

Build an app and its cloud infrastructure in one TypeScript program.

Effect describes work with typed failures and required services. A service is a named interface for one job. Alchemy declares cloud resources and plans changes before applying them.

The fence is the compiler checks, lint rules, and hooks that reject prohibited code and shortcuts.

## Read this repo

- [Home](${origin}/): short overview
- [Glossary](${origin}/glossary): A–Z terms with definitions and teaching pages
- [Public content corpus](${origin}/llms-full.txt): rules, lore, and skills in one response
- [HTTP API](${origin}/openapi.json): routes, inputs, outputs, and errors
- [MCP server](${origin}/mcp): Model Context Protocol tools for search, reading, and code in a restricted environment
- [Code mode](${origin}/api/execute): run a program instead of several calls; POST JSON with a \`code\` string, or call the MCP \`execute\` tool
- [CAFE news](${origin}/news): reviewed Cloudflare, Alchemy, Foldkit and Effect news, ranked by engagement and freshness; also an [Atom feed](${origin}/news.xml) and the \`listCafeNews\` tool
- [CAFE directory](${origin}/directory): reviewed projects with per-letter stack evidence; also the \`listCafeProjects\` tool

## Connect with MCP

MCP means Model Context Protocol. It lets an agent client discover and call tools.

Point any MCP client at \`${origin}/mcp\`. Protocol 2026-07-28 is stateless and has no \`initialize\` handshake: every request sends \`MCP-Protocol-Version\`, \`Mcp-Method\`, and the \`params._meta\` block shown here.

\`\`\`sh
${mcpToolsListExample(origin)}
\`\`\`

Older clients (2025-11-25 back to 2024-11-05) send \`initialize\` as usual. Each one gets its own session, held between requests by a Durable Object, Cloudflare's persistent state and compute service.

Each IP may make 120 API or MCP requests per 60 seconds. \`execute\` also allows 6 calls per IP and 300 total calls per 60 seconds. Cloudflare counts these limits separately in each location.

## Run code: one program instead of several calls

A capability is one named action with shared input and output definitions and a server-side implementation.

Use \`POST /api/execute\` or the MCP \`execute\` tool to call content capabilities. The program can search, pass the result to read, and return only what you need. It cannot call \`joinInterest\`.

\`execute\` runs the \`code\` value as the body of an async function. \`return\` sets \`result\`, and \`console.log\` output appears in \`logs\`; imports, exports, and \`fetch\` are unavailable.

\`\`\`js
const found = await tools.search({ query: "cartridges", limit: 1 });
const page = await tools.read({ id: found.matches[0].id });
return { title: page.title, id: page.id };
\`\`\`

\`\`\`sh
curl --request POST '${origin}/api/execute' \\
  --header 'content-type: application/json' \\
  --data '{"code":"return 1 + 1"}'
# {"logs":[],"result":2}
\`\`\`

${agentNextActions(origin)}
## Source files

${entryList(catalog.resources.filter((resource) => resource.kind === "law"))}

## Lore

${(["idea", "concept", "source", "person"] as const)
  .flatMap((group) => {
    const pages = catalog.resources.filter(
      (resource) => resource.kind === "lore" && resource.group === group
    );

    return pages.length === 0
      ? []
      : [
          `### ${group[0]?.toUpperCase()}${group.slice(1)}`,
          "",
          entryList(pages),
        ];
  })
  .join("\n\n")}

## Systems

${entryList(catalog.resources.filter((resource) => resource.kind === "lore" && resource.group === "system"))}

## Skills

${entryList(catalog.resources.filter((resource) => resource.kind === "skill"))}

## Lore on this page

${catalog.llmsLoreLinks.replaceAll(originToken, origin)}
`;

export const llmsFullText = (
  origin: string,
  catalog: ContentCatalog,
  contentResources: readonly ContentResource[]
) =>
  [
    llmsText(origin, catalog).replace("\n", `\n\n${agentPointerMarkdown}\n`),
    ...contentResources.map(
      (resource) =>
        `\n---\n\n# ${resource.routePath}\n\nSource: ${resource.sourcePath}\nSHA-256: ${resource.digest}\n\n${canonicalMarkdownLinks(resource.bodyMarkdown, resource.routePath, origin)}`
    ),
  ].join("\n");

export const glossaryIndex = (catalog: ContentCatalog) =>
  catalog.glossaryIndexMarkdown;

export const skillIndex = (catalog: ContentCatalog) =>
  catalog.skillIndexMarkdown;

export const loreIndex = (catalog: ContentCatalog) => catalog.loreIndexMarkdown;

export const systemsIndex = (catalog: ContentCatalog) =>
  catalog.systemsIndexMarkdown;

export const robotsText = `User-agent: *
Allow: /
Content-Signal: ai-train=no, search=yes, ai-input=yes

User-agent: GPTBot
User-agent: OAI-SearchBot
User-agent: Claude-Web
User-agent: Google-Extended
User-agent: Amazonbot
User-agent: anthropic-ai
User-agent: Bytespider
User-agent: CCBot
User-agent: Applebot-Extended
Allow: /

Sitemap: https://ratstack.sh/sitemap.xml
`;

export const agentSkillPath = (name: string) =>
  `/.well-known/agent-skills/${name}/SKILL.md` as const;

export const publicPaths = (catalog: ContentCatalog) =>
  [
    "/",
    "/auth.md",
    "/llms.txt",
    "/llms-full.txt",
    "/openapi.json",
    "/robots.txt",
    "/sitemap.xml",
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

export const sitemapXml = (
  origin: string,
  catalog: ContentCatalog
) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${catalog.pageRoutes
  .filter((path) => path !== "/log.md")
  .map((path) => {
    const resource = catalog.resources.find(
      (entry) => entry.routePath === path
    );

    const lastmod = resource?.dateModified ?? resource?.datePublished;

    return `  <url><loc>${origin}${path}</loc>${lastmod === undefined ? "" : `<lastmod>${lastmod}</lastmod>`}</url>`;
  })
  .join("\n")}
</urlset>
`;

const serviceLinkHeaders = [
  `</.well-known/api-catalog>; rel="api-catalog"`,
  `</.well-known/mcp.json>; rel="service-desc"; type="application/json"`,
  `</.well-known/agent-card.json>; rel="service-desc"; type="application/a2a+json"`,
  `</.well-known/ai-catalog.json>; rel="ai-catalog"; type="application/json"`,
  `</.well-known/agent-skills/index.json>; rel="describedby"; type="application/json"`,
];

export const linkHeaderForPage = (pagePath: string) =>
  [
    ...serviceLinkHeaders,
    ...markdownDiscoveryLinks(pagePath).map(
      (link) => `<${link.href}>; rel="${link.rel}"; type="${link.type}"`
    ),
  ].join(", ");

export const linkHeader = linkHeaderForPage("/");

export const agentSkillsIndex = (catalog: ContentCatalog) => ({
  $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
  skills: catalog.resources
    .filter((resource) => resource.kind === "skill")
    .map((skill) => ({
      description: skill.description,
      digest: `sha256:${skill.digest}`,
      name: skill.name,
      type: "skill-md",
      url: agentSkillPath(skill.name),
    })),
});

export const apiCatalog = (origin: string) => ({
  linkset: [
    {
      anchor: `${origin}/mcp`,
      "service-desc": [
        {
          href: `${origin}/.well-known/mcp.json`,
          type: "application/json",
        },
        {
          href: `${origin}/openapi.json`,
          type: "application/json",
        },
      ],
      "service-doc": [{ href: `${origin}/llms.txt`, type: "text/markdown" }],
    },
  ],
});

export const mcpServerCard = (origin: string) => ({
  authentication: { required: false },
  capabilities: {
    prompts: {},
    resources: {},
    tools: {},
  },
  protocolVersion: "2026-07-28",
  protocolVersions: mcpProtocolVersions,
  serverInfo: { name: "sh.ratstack/rat-stack", version: "0.2.0" },
  transport: { endpoint: `${origin}/mcp`, type: "streamable-http" },
  "x-ratstack-example": mcpToolsListExample(origin),
});

export const a2aAgentCard = (origin: string) => ({
  capabilities: {
    extendedAgentCard: false,
    pushNotifications: false,
    streaming: false,
  },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  description:
    "Answers questions about rat-stack by searching and reading its public files.",
  name: "Rat Stack",
  skills: [
    {
      description:
        "Answer a rat-stack question by searching the public law and skills, then reading the matching sources.",
      examples: [
        "How do I add a capability?",
        "Where does lifecycle state live?",
      ],
      id: "answer-rat-stack-question",
      name: "Answer a rat-stack question",
      tags: ["rat-stack", "documentation", "source-grounded"],
    },
  ],
  supportedInterfaces: [
    {
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
      url: `${origin}/a2a`,
    },
  ],
  version: "0.1.0",
});

export const ardManifest = (origin: string) => ({
  entries: [
    {
      displayName: "Rat Stack MCP",
      identifier: "urn:air:ratstack.sh:server:mcp",
      representativeQueries: [
        "how do I add a capability",
        "show the rat-stack project law",
      ],
      type: "application/mcp-server-card+json",
      url: `${origin}/.well-known/mcp.json`,
    },
    {
      displayName: "Rat Stack A2A Agent",
      identifier: "urn:air:ratstack.sh:agent:a2a",
      representativeQueries: [
        "answer a question about rat-stack",
        "where does rat-stack lifecycle state live",
      ],
      type: "application/a2a+json",
      url: `${origin}/.well-known/agent-card.json`,
    },
  ],
  host: {
    displayName: "Rat Stack",
    identifier: "did:web:ratstack.sh",
  },
  specVersion: "1.0",
});
