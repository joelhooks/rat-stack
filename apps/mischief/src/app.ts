import { toHttpApi } from "@rat-stack/capability/http-api";
import { toToolkit } from "@rat-stack/capability/toolkit";
import type {
  AssetReadError,
  ResourceNotFound,
} from "@rat-stack/core/contracts";
import { IntakeTicket } from "@rat-stack/core/intake";
import type { InterestTokens } from "@rat-stack/core/interest";
import * as AlchemyHttp from "alchemy/Http";
import type { Context } from "effect";
import { Cause, Effect, Layer, Option, Predicate, Schema } from "effect";
import * as McpProtocol from "effect/ai/McpProtocol";
import * as McpServer from "effect/ai/McpServer";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import * as HttpHeaders from "effect/http/Headers";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { a2aError, decodeA2aRequest, handleA2aRequest } from "./a2a.js";
import {
  errorPageTemplates,
  originToken,
} from "./bundled-content.generated.js";
import { capabilities, contentLayer, search } from "./capabilities/index.js";
import type { ContentCatalogData as ContentCatalog } from "./content-data.js";
import { ContentStore } from "./content-store.js";
import {
  a2aAgentCard,
  agentSkillPath,
  agentSkillsIndex,
  apiCatalog,
  ardManifest,
  authMarkdown,
  linkHeaderForPage,
  llmsFullText,
  llmsText,
  mcpServerCard,
  mcpVersionText,
  robotsText,
  sitemapXml,
  staticContentVersion,
  staticAssetGeneration,
  tokenmaxxDocumentHtml,
  tokenmaxxCopyScript,
  tokenmaxxCopyScriptHash,
  tokenmaxxMarkdown,
} from "./content.js";
import { renderErrorPage } from "./error-page.js";
import type { ErrorPage } from "./error-page.js";
import { renderStaticDocument } from "./html.js";
import {
  privateHttpTracingLayer,
  privateMcpTracingLayer,
} from "./http-privacy.js";
import { joinRequestMiddleware } from "./interest/join-request.js";
import { withAvailablePageTicket } from "./interest/page-ticket.js";
import { retiredInterestRoutes } from "./interest/retired-routes.js";
import { interestRoutes } from "./interest/routes.js";
import type { InterestOptions } from "./interest/routes.js";
import { UNSUBSCRIBE_PATH, unsubscribeRoutes } from "./interest/unsubscribe.js";
import { legacySessionNotFound } from "./legacy-mcp/session.js";
import { mcpContent } from "./mcp-content.js";
import type { RateLimitName, RateLimits } from "./rate-limits.js";
import { contentSecurityPolicy } from "./security.js";
import { StaticAssets } from "./static-assets.js";
import { decodeEd25519PrivateJwk, publicKeyDirectory } from "./web-bot-auth.js";

const markdown = (body: string) =>
  HttpServerResponse.text(body, {
    contentType: "text/markdown; charset=utf-8",
  });

const json = (body: Schema.Json, contentType = "application/json") =>
  HttpServerResponse.jsonUnsafe(body, {
    contentType,
    headers: { "access-control-allow-origin": "*" },
  });

const originOf = (request: HttpServerRequest.HttpServerRequest) =>
  new URL(request.url, "https://ratstack.sh").origin;

const previewCrawler =
  /(?:Twitterbot|facebookexternalhit|Facebot|Slackbot|Discordbot|LinkedInBot|WhatsApp|TelegramBot|Bluesky|Mastodon|Pinterestbot|redditbot|Applebot)/iu;

const agentCrawler =
  /(?:GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|CCBot|Bytespider|Amazonbot|cohere-ai|Meta-ExternalAgent|MistralAI-User|DuckAssistBot|Applebot-Extended)/iu;

const acceptedMediaTypes = (accept: string | undefined) =>
  (accept ?? "")
    .split(",")
    .map((entry) => {
      const [mediaType, ...parameters] = entry.trim().toLowerCase().split(";");

      const quality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith("q="));

      return { mediaType: mediaType ?? "", rejected: quality === "q=0" };
    })
    .filter((entry) => entry.mediaType !== "" && !entry.rejected)
    .map((entry) => entry.mediaType);

const acceptsHtml = (request: HttpServerRequest.HttpServerRequest) => {
  const accepted = acceptedMediaTypes(request.headers.accept);

  if (accepted.includes("text/html")) {
    return true;
  }

  if (accepted.includes("text/markdown")) {
    return false;
  }

  const userAgent = request.headers["user-agent"] ?? "";

  if (previewCrawler.test(userAgent)) {
    return true;
  }

  if (agentCrawler.test(userAgent)) {
    return false;
  }

  return userAgent.startsWith("Mozilla/");
};

const pathQuery = (pathname: string) => {
  const segments = pathname.split("/").filter((segment) => segment !== "");
  const last = segments.pop() ?? "";
  const extensionless = last.replace(/\.[^.]+$/u, "");

  return [...segments, extensionless]
    .flatMap((segment) => segment.split(/[._-]+/u))
    .filter((segment) => segment !== "")
    .join(" ");
};

const errorResponse = (
  request: HttpServerRequest.HttpServerRequest,
  page: ErrorPage,
  isHtml = acceptsHtml(request)
) =>
  HttpServerResponse.text(renderErrorPage(page, originOf(request), isHtml), {
    contentType: isHtml
      ? "text/html; charset=utf-8"
      : "text/markdown; charset=utf-8",
    status: page.code,
  });

const searchNotFound = (request: HttpServerRequest.HttpServerRequest) => {
  const { pathname } = new URL(request.url, "https://ratstack.sh");
  const query = pathQuery(pathname);

  return search.handler({ limit: 3, query }).pipe(
    Effect.map(({ matches }) =>
      errorResponse(request, {
        code: 404,
        matches,
        message: "That bin got pulled out.",
        path: pathname,
        title: "Not found",
      })
    )
  );
};

const machinePath = (pathname: string) =>
  pathname === UNSUBSCRIBE_PATH ||
  pathname === "/api" ||
  pathname.startsWith("/api/") ||
  pathname === "/mcp" ||
  pathname.startsWith("/mcp/") ||
  pathname === "/openapi.json" ||
  pathname.startsWith("/openapi.json/") ||
  pathname === "/a2a" ||
  pathname.startsWith("/a2a/") ||
  pathname.startsWith("/.well-known/");

export interface StaticResponseCache {
  readonly match: (request: Request) => Promise<Response | undefined>;
  readonly put: (request: Request, response: Response) => Promise<void>;
}

const staticPaths = new Set([
  "/auth.md",
  "/llms.txt",
  "/llms-full.txt",
  "/openapi.json",
  "/robots.txt",
  "/sitemap.xml",
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
  "/.well-known/agent-skills/index.json",
  "/.well-known/ai-catalog.json",
  "/.well-known/api-catalog",
  "/.well-known/mcp.json",
]);

const htmlRevalidateEveryVisit = "no-cache";

const staticCacheControl =
  "public, max-age=60, s-maxage=31536000, stale-while-revalidate=86400";

const assetCacheControl =
  "public, max-age=14400, s-maxage=31536000, stale-while-revalidate=86400";

const staticRepresentation = () => "default";

const staticEtag = (path: string, representation: string) =>
  `W/"${staticContentVersion}:${representation}:${encodeURIComponent(path)}"`;

const assetEtag = (path: string, representation: string) =>
  `W/"${staticAssetGeneration}:${representation}:${encodeURIComponent(path)}"`;

const matchesEtag = (requestValue: string | undefined, etag: string) =>
  requestValue
    ?.split(",")
    .map((value) => value.trim())
    .some((value) => value === etag || value === "*") === true;

const staticAssetPagePath = (path: string, catalog: ContentCatalog) => {
  if (catalog.pageRoutes.includes(path)) {
    return path;
  }

  if (path === "/index.md") {
    return "/";
  }

  const canonical = path.endsWith(".md") ? path.slice(0, -3) : undefined;

  return canonical !== undefined && catalog.pageRoutes.includes(canonical)
    ? canonical
    : undefined;
};

const staticHeaders = (
  path: string,
  etag: string,
  cacheStatus: "HIT" | "MISS" | "REVALIDATED"
) => {
  const headers = HttpHeaders.fromInput({
    "cache-control": staticCacheControl,
    etag,
    "x-ratstack-cache": cacheStatus,
  });

  return headers;
};

const assetImageContentType = (path: string) => {
  if (path.endsWith(".jpg")) {
    return "image/jpeg";
  }

  if (path.endsWith(".ico")) {
    return "image/x-icon";
  }

  if (path.endsWith(".svg")) {
    return "image/svg+xml; charset=utf-8";
  }

  return "image/png";
};

const assetImageResponse = (
  request: HttpServerRequest.HttpServerRequest,
  path: string,
  bytes: Uint8Array
) => {
  const etag = assetEtag(path, "default");
  const revalidated = matchesEtag(request.headers["if-none-match"], etag);

  let headers = HttpHeaders.set(
    staticHeaders(path, etag, revalidated ? "REVALIDATED" : "MISS"),
    "cache-control",
    path.endsWith(".jpg") ? "public, max-age=86400" : assetCacheControl
  );

  if (path.startsWith("/tokenmaxx/")) {
    headers = HttpHeaders.set(headers, "x-robots-tag", "noindex");
  }

  if (revalidated) {
    return HttpServerResponse.empty({ headers, status: 304 });
  }

  return HttpServerResponse.uint8Array(bytes, {
    contentType: assetImageContentType(path),
    headers,
  });
};

const assetPageResponse = (
  request: HttpServerRequest.HttpServerRequest,
  path: string,
  page: string,
  isHtml: boolean,
  bytes: Uint8Array
) => {
  const etag = assetEtag(path, isHtml ? "html" : "default");
  const revalidated = matchesEtag(request.headers["if-none-match"], etag);

  let headers = HttpHeaders.fromInput({
    "cache-control": isHtml ? "no-cache" : assetCacheControl,
    etag,
    vary: "Accept",
    "x-ratstack-cache": revalidated ? "REVALIDATED" : "MISS",
  });

  if (isHtml) {
    headers = HttpHeaders.set(
      headers,
      "content-security-policy",
      contentSecurityPolicy(
        "'none'",
        page === "/" ? tokenmaxxCopyScriptHash : undefined
      )
    );
  }

  if (revalidated) {
    return HttpServerResponse.empty({ headers, status: 304 });
  }

  const text = new TextDecoder().decode(bytes);

  return HttpServerResponse.text(
    isHtml
      ? renderStaticDocument(originOf(request), text)
      : text.replaceAll(originToken, originOf(request)),
    {
      contentType: isHtml
        ? "text/html; charset=utf-8"
        : "text/markdown; charset=utf-8",
      headers,
    }
  );
};

const unavailableResponse = (request: HttpServerRequest.HttpServerRequest) =>
  errorResponse(
    request,
    {
      code: 503,
      message: "Static content is unavailable. Retry shortly.",
      path: new URL(request.url, "https://ratstack.sh").pathname,
      title: "Service unavailable",
    },
    !new URL(request.url, "https://ratstack.sh").pathname.endsWith(".md") &&
      acceptsHtml(request)
  ).pipe(
    HttpServerResponse.setHeaders({
      "cache-control": "no-store",
      vary: "Accept",
    })
  );

const assetRoutes = (
  assets: StaticAssets["Service"],
  store: ContentStore["Service"]
) =>
  HttpRouter.middleware(
    (httpEffect) =>
      Effect.gen(function* serveStaticAsset() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const path = new URL(request.url, "https://ratstack.sh").pathname;

        if (
          (request.method !== "GET" && request.method !== "HEAD") ||
          machinePath(path) ||
          path === "/tokenmaxx"
        ) {
          return yield* httpEffect;
        }

        return yield* Effect.gen(function* readStaticAsset() {
          const catalog = yield* store.catalog;
          const page = staticAssetPagePath(path, catalog);
          const image = catalog.imagePaths.includes(path);

          if (page === undefined && !image) {
            return yield* httpEffect;
          }

          const isHtml =
            page !== undefined && path === page && acceptsHtml(request);

          const stem = page === "/" ? "/index" : page;

          const assetPath =
            page === undefined ? path : `${stem}.${isHtml ? "html" : "md"}`;

          const bytes = yield* assets.read(assetPath);

          return page === undefined
            ? assetImageResponse(request, path, bytes)
            : assetPageResponse(request, path, page, isHtml, bytes);
        }).pipe(
          Effect.catchTag("AssetReadError", (error) =>
            Effect.logError(error).pipe(Effect.as(unavailableResponse(request)))
          )
        );
      }),
    { global: true }
  );

const staticCacheKey = (
  request: HttpServerRequest.HttpServerRequest,
  representation: string
) => {
  const url = new URL(request.url, "https://ratstack.sh");
  url.hash = "";
  url.search = "";
  url.searchParams.set("__ratstack_content", staticContentVersion);
  url.searchParams.set("__ratstack_representation", representation);

  return new Request(url, { method: "GET" });
};

const staticCaching = (cache: StaticResponseCache) =>
  HttpRouter.middleware(
    (httpEffect) =>
      Effect.gen(function* cacheStaticResponse() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const path = new URL(request.url, "https://ratstack.sh").pathname;

        if (
          request.method !== "GET" ||
          path === "/tokenmaxx" ||
          !staticPaths.has(path)
        ) {
          return yield* httpEffect;
        }

        const representation = staticRepresentation();
        const etag = staticEtag(path, representation);

        const revalidated = matchesEtag(request.headers["if-none-match"], etag);

        if (revalidated) {
          return HttpServerResponse.empty({
            headers: staticHeaders(path, etag, "REVALIDATED"),
            status: 304,
          });
        }

        const key = staticCacheKey(request, representation);

        const cached = yield* Effect.tryPromise(
          // oxlint-disable-next-line typescript/promise-function-async -- Cloudflare's Cache API owns this Promise-returning boundary.
          () => cache.match(key)
        ).pipe(Effect.orElseSucceed(() => null));

        if (cached !== null && cached !== undefined) {
          const headers = new Headers(cached.headers);
          headers.set("x-ratstack-cache", "HIT");

          return HttpServerResponse.fromWeb(
            new Response(cached.body, {
              headers,
              status: cached.status,
              statusText: cached.statusText,
            })
          );
        }

        const original = yield* httpEffect;

        if (original.status !== 200) {
          return original;
        }

        const response = original.pipe(
          HttpServerResponse.setHeaders(staticHeaders(path, etag, "MISS"))
        );

        if (response.status === 200) {
          const webResponse = HttpServerResponse.toWeb(response);
          yield* Effect.tryPromise(
            // oxlint-disable-next-line typescript/promise-function-async -- Cloudflare's Cache API owns this Promise-returning boundary.
            () => cache.put(key, webResponse)
          ).pipe(Effect.orElseSucceed(() => null));
        }

        return response;
      }),
    { global: true }
  );

export const toolkitProjection = toToolkit(capabilities);

const RateLimited = Schema.String.annotate({
  description:
    "Rate limit exceeded for this IP or for execute globally. Retry after the number of seconds in Retry-After.",
  httpApiStatus: 429,
  identifier: "RateLimited",
}).pipe(HttpApiSchema.asText({ contentType: "text/plain" }));

export const apiProjection = toHttpApi("ratstack.sh", capabilities, {
  errors: [RateLimited],
  prefix: "/api",
});

const apiRoutes = HttpApiBuilder.layer(apiProjection.api, {
  openapiPath: "/openapi.json",
}).pipe(
  Layer.provide(apiProjection.layer),
  Layer.provide(AlchemyHttp.Platform)
);

export const modernMcpProtocols = [McpProtocol.v2026_07_28] as const;

export const legacyMcpProtocols = [
  McpProtocol.v2025_11_25,
  McpProtocol.v2025_06_18,
  McpProtocol.v2025_03_26,
  McpProtocol.v2024_11_05,
] as const;

const mcpTransport = (
  protocols: typeof modernMcpProtocols | typeof legacyMcpProtocols
) =>
  McpServer.layerHttp({
    allowedOrigins: ["https://ratstack.sh", "http://localhost:1337"],
    description:
      "Search, read, and traverse the rat-stack source corpus and lore graph",
    instructions:
      "Use search and read for source text. Use backlinks, neighbors, mentions, and path to traverse lore relationships. Use execute when one short program can replace several tool calls.",
    name: "sh.ratstack/rat-stack",
    path: "/mcp",
    protocols,
    version: "0.2.0",
    websiteUrl: "https://ratstack.sh/",
  }).pipe(Layer.provide(privateMcpTracingLayer));

export const mcpLayer = (
  protocols: typeof modernMcpProtocols | typeof legacyMcpProtocols
) =>
  Layer.mergeAll(
    McpServer.toolkit(toolkitProjection.toolkit).pipe(
      Layer.provide(toolkitProjection.layer)
    ),
    mcpContent
  ).pipe(Layer.provide(mcpTransport(protocols)));

const mcp = mcpLayer(modernMcpProtocols);

const noVerifyResponse = (request: HttpServerRequest.HttpServerRequest) =>
  errorResponse(request, {
    code: 403,
    details: errorPageTemplates.noVerifyDetails,
    message: "The rat looks disappointed.",
    path: new URL(request.url, "https://ratstack.sh").pathname,
    title: "Forbidden",
  });

export const tokenmaxxResponse = (
  request: HttpServerRequest.HttpServerRequest
) =>
  Effect.gen(function* tokenmaxxPage() {
    const isHtml = acceptsHtml(request);

    const body = isHtml
      ? renderStaticDocument(
          originOf(request),
          tokenmaxxDocumentHtml
        ).replaceAll(
          "__COPY_SCRIPT__",
          `<script>${tokenmaxxCopyScript}</script>`
        )
      : yield* withAvailablePageTicket(tokenmaxxMarkdown);

    return HttpServerResponse.text(body, {
      contentType: isHtml
        ? "text/html; charset=utf-8"
        : "text/markdown; charset=utf-8",
      headers: {
        "cache-control": "no-store",
        "content-security-policy": contentSecurityPolicy(
          "'none'",
          tokenmaxxCopyScriptHash
        ),
        vary: "Accept",
        "x-robots-tag": "noindex",
      },
    });
  });

const contentRoutes = () =>
  Layer.unwrap(
    Effect.gen(function* buildContentRoutes() {
      const tickets = yield* Effect.serviceOption(IntakeTicket);
      const store = yield* ContentStore;

      return Layer.mergeAll(
        HttpRouter.add("GET", "/tokenmaxx", (request) => {
          const response = tokenmaxxResponse(request);

          return Option.isSome(tickets)
            ? response.pipe(Effect.provideService(IntakeTicket, tickets.value))
            : response;
        }),
        HttpRouter.add("GET", "/llms.txt", (request) =>
          store.catalog.pipe(
            Effect.map((catalog) =>
              markdown(llmsText(originOf(request), catalog))
            )
          )
        ),
        HttpRouter.add("GET", "/llms-full.txt", (request) =>
          store.catalog.pipe(
            Effect.flatMap((catalog) =>
              Effect.all(
                catalog.resources.map((resource) => store.read(resource.id))
              ).pipe(
                Effect.map((resources) =>
                  markdown(llmsFullText(originOf(request), catalog, resources))
                )
              )
            )
          )
        ),
        HttpRouter.add("GET", "/auth.md", markdown(authMarkdown)),
        HttpRouter.add(
          "GET",
          "/robots.txt",
          HttpServerResponse.text(robotsText, {
            contentType: "text/plain; charset=utf-8",
          })
        ),
        HttpRouter.add("GET", "/sitemap.xml", (request) =>
          store.catalog.pipe(
            Effect.map((catalog) =>
              HttpServerResponse.text(sitemapXml(originOf(request), catalog), {
                contentType: "application/xml; charset=utf-8",
              })
            )
          )
        ),
        HttpRouter.add(
          "GET",
          "/.well-known/agent-skills/index.json",
          store.catalog.pipe(
            Effect.map((catalog) => json(agentSkillsIndex(catalog)))
          )
        ),
        HttpRouter.add("GET", "/.well-known/ai-catalog.json", (request) =>
          Effect.succeed(json(ardManifest(originOf(request))))
        ),
        ...(
          ["/.well-known/agent-card.json", "/.well-known/agent.json"] as const
        ).map((path) =>
          HttpRouter.add("GET", path, (request) =>
            Effect.succeed(
              json(a2aAgentCard(originOf(request)), "application/a2a+json")
            )
          )
        ),
        HttpRouter.add("POST", "/a2a", (request) =>
          request.json.pipe(
            Effect.flatMap(decodeA2aRequest),
            Effect.flatMap(handleA2aRequest),
            Effect.map((response) => json(response, "application/a2a+json")),
            Effect.orElseSucceed(() =>
              json(a2aError(-32_600, "Invalid Request"), "application/a2a+json")
            )
          )
        ),
        HttpRouter.add("GET", "/.well-known/api-catalog", (request) =>
          Effect.succeed(
            json(apiCatalog(originOf(request)), "application/linkset+json")
          )
        ),
        HttpRouter.add("GET", "/.well-known/mcp.json", (request) =>
          Effect.succeed(json(mcpServerCard(originOf(request))))
        ),
        HttpRouter.add(
          "GET",
          "/.well-known/agent-skills/:name/SKILL.md",
          (request) =>
            store.catalog.pipe(
              Effect.flatMap((catalog) => {
                const { pathname } = new URL(
                  request.url,
                  "https://ratstack.sh"
                );

                const skill = catalog.resources.find(
                  (resource) =>
                    resource.kind === "skill" &&
                    agentSkillPath(resource.name) === pathname
                );

                return skill === undefined
                  ? Effect.succeed(
                      HttpServerResponse.text("Not found.\\n", { status: 404 })
                    )
                  : store
                      .read(skill.id)
                      .pipe(Effect.map((resource) => markdown(resource.text)));
              })
            )
        ),
        ...(["/--no-verify", "/no-verify"] as const).map((path) =>
          HttpRouter.add("GET", path, (request) =>
            Effect.succeed(noVerifyResponse(request))
          )
        ),
        HttpRouter.add("GET", "/*", (request) => {
          const { pathname } = new URL(request.url, "https://ratstack.sh");

          return machinePath(pathname)
            ? Effect.succeed(
                HttpServerResponse.text("Not found.\n", {
                  contentType: "text/plain; charset=utf-8",
                  status: 404,
                })
              )
            : searchNotFound(request);
        }),
        ...(
          ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "QUERY"] as const
        ).map((method) =>
          HttpRouter.add(
            method,
            "/*",
            HttpServerResponse.text("Not found.\n", {
              contentType: "text/plain; charset=utf-8",
              status: 404,
            })
          )
        )
      );
    })
  );

const JsonRpcEnvelope = Schema.Struct({
  id: Schema.optional(
    Schema.Union([Schema.String, Schema.Finite, Schema.Null])
  ),
  method: Schema.optional(Schema.String),
  params: Schema.optional(
    Schema.Struct({ name: Schema.optional(Schema.Unknown) })
  ),
});

const inspectMcpRequest = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* inspectRequest() {
    const { source } = request;

    const body: unknown =
      source instanceof Request
        ? yield* Effect.tryPromise(
            // oxlint-disable-next-line typescript/promise-function-async -- The Fetch Request owns this Promise-returning boundary.
            () => source.clone().json()
          )
        : yield* request.json;

    return yield* Schema.decodeUnknownEffect(JsonRpcEnvelope)(body);
  }).pipe(Effect.orElseSucceed(() => null));

const exceededMessage = (name: RateLimitName) =>
  `${name} rate limit exceeded; retry after 60 seconds.`;

const rateLimitResponse = (
  request: HttpServerRequest.HttpServerRequest,
  name: RateLimitName,
  mcpToolCall: boolean
) => {
  const message = exceededMessage(name);

  if (!request.url.startsWith("/mcp")) {
    return Effect.succeed(
      HttpServerResponse.text(message, {
        headers: { "retry-after": "60" },
        status: 429,
      })
    );
  }

  return inspectMcpRequest(request).pipe(
    Effect.map((envelope) =>
      HttpServerResponse.jsonUnsafe(
        mcpToolCall
          ? {
              id: envelope?.id ?? null,
              jsonrpc: "2.0",
              result: {
                content: [{ text: message, type: "text" }],
                isError: true,
              },
            }
          : {
              error: { code: -32_000, message },
              id: envelope?.id ?? null,
              jsonrpc: "2.0",
            },
        { headers: { "retry-after": "60" } }
      )
    )
  );
};

export interface LegacyMcpRouter {
  readonly forward: (
    session: string,
    request: Request
  ) => Effect.Effect<Response>;
}

const MODERN_MCP_VERSION = "2026-07-28";

const sessionIdPattern =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u;

interface McpRequestRouting {
  readonly envelope: typeof JsonRpcEnvelope.Type | null;
  readonly isApi: boolean;
  readonly isExecute: boolean;
  readonly isMcp: boolean;
  readonly mcpToolCall: boolean;
  readonly modernMcp: boolean;
}

const routingOf = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* routeRequest() {
    const path = new URL(request.url, "https://ratstack.sh").pathname;
    const isMcp = path === "/mcp";

    const modernMcp =
      request.headers["mcp-protocol-version"] === MODERN_MCP_VERSION;

    const envelope =
      isMcp && !modernMcp && request.method === "POST"
        ? yield* inspectMcpRequest(request)
        : null;

    const mcpMethod = request.headers["mcp-method"] ?? envelope?.method;
    const mcpToolName = request.headers["mcp-name"] ?? envelope?.params?.name;
    const mcpToolCall = isMcp && mcpMethod === "tools/call";

    return {
      envelope,
      isApi: path === "/api" || path.startsWith("/api/"),
      isExecute:
        path === "/api/execute" || (mcpToolCall && mcpToolName === "execute"),
      isMcp,
      mcpToolCall,
      modernMcp,
    } satisfies McpRequestRouting;
  });

const firstExceededLimit = (
  rateLimits: RateLimits,
  request: HttpServerRequest.HttpServerRequest,
  routing: McpRequestRouting
) =>
  Effect.gen(function* checkLimits() {
    const clientIp = request.headers["cf-connecting-ip"] ?? "unknown";

    const checks: readonly (readonly [RateLimitName, string])[] = [
      ["API_PER_IP", clientIp],
      ...(routing.isExecute
        ? ([
            ["EXECUTE_PER_IP", clientIp],
            ["EXECUTE_GLOBAL", "global"],
          ] as const)
        : []),
    ];

    for (const [name, key] of checks) {
      if (!(yield* rateLimits.limit(name, key))) {
        return name;
      }
    }

    return null;
  });

const legacySessionOf = (
  request: HttpServerRequest.HttpServerRequest,
  routing: McpRequestRouting
) => {
  if (!routing.isMcp || routing.modernMcp) {
    return null;
  }

  const existing = request.headers["mcp-session-id"];

  if (existing !== undefined) {
    return existing;
  }

  if (routing.envelope?.method !== "initialize") {
    return null;
  }

  // @effect-diagnostics-next-line cryptoRandomUUID:off -- Workers ship Web Crypto and Effect has no Web Crypto layer; a random session id needs no injectable service.
  return crypto.randomUUID();
};

const routeLegacyMcp = (
  router: LegacyMcpRouter,
  request: HttpServerRequest.HttpServerRequest,
  session: string,
  routing: McpRequestRouting
) =>
  Effect.gen(function* routeLegacy() {
    if (!sessionIdPattern.test(session)) {
      return HttpServerResponse.fromWeb(
        legacySessionNotFound(routing.envelope?.id)
      );
    }

    const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);

    return HttpServerResponse.fromWeb(yield* router.forward(session, web));
  });

const needsVersionHelp = (
  request: HttpServerRequest.HttpServerRequest,
  routing: McpRequestRouting
) =>
  routing.isMcp &&
  (request.method === "GET" ||
    (request.method === "POST" &&
      request.headers["mcp-protocol-version"] === undefined &&
      routing.envelope?.method === "initialize"));

const requestProtection = (options: {
  readonly legacyMcp?: LegacyMcpRouter;
  readonly rateLimits?: RateLimits;
}) =>
  HttpRouter.middleware(
    (httpEffect) =>
      Effect.gen(function* protectRequest() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const routing = yield* routingOf(request);

        if (
          (routing.isMcp || routing.isApi) &&
          options.rateLimits !== undefined
        ) {
          const exceeded = yield* firstExceededLimit(
            options.rateLimits,
            request,
            routing
          );

          if (exceeded !== null) {
            return yield* rateLimitResponse(
              request,
              exceeded,
              routing.mcpToolCall
            );
          }
        }

        const session =
          options.legacyMcp === undefined
            ? null
            : legacySessionOf(request, routing);

        if (session !== null && options.legacyMcp !== undefined) {
          return yield* routeLegacyMcp(
            options.legacyMcp,
            request,
            session,
            routing
          );
        }

        if (needsVersionHelp(request, routing)) {
          return HttpServerResponse.text(mcpVersionText(originOf(request)), {
            contentType: "text/plain; charset=utf-8",
            status: request.method === "POST" ? 400 : 200,
          });
        }

        return yield* httpEffect;
      }),
    { global: true }
  );

const discoveryPath = (pagePath: string, catalog: ContentCatalog) => {
  const page = staticAssetPagePath(pagePath, catalog);

  if (page !== undefined) {
    return page;
  }

  if (pagePath === "/tokenmaxx" || pagePath === "/--no-verify") {
    return pagePath;
  }

  return "/";
};

const linkHeaders = (store: ContentStore["Service"]) =>
  HttpRouter.middleware(
    (httpEffect) =>
      Effect.gen(function* addDiscoveryHeaders() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const response = yield* httpEffect;
        const pagePath = new URL(request.url, "https://ratstack.sh").pathname;

        if (response.status >= 500 || machinePath(pagePath)) {
          return HttpServerResponse.setHeader(
            response,
            "Link",
            linkHeaderForPage("/")
          );
        }

        const catalog = yield* store.catalog;

        return HttpServerResponse.setHeader(
          response,
          "Link",
          linkHeaderForPage(discoveryPath(pagePath, catalog))
        );
      }),
    { global: true }
  );

const securityHeaders = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-fence": "electrified",
  "x-frame-options": "DENY",
};

const errorTitles = new Map([
  [400, "Bad request"],
  [401, "Unauthorized"],
  [403, "Forbidden"],
  [404, "Not found"],
  [410, "Gone"],
  [422, "Invalid request"],
  [429, "Too many requests"],
  [500, "Internal server error"],
  [503, "Service unavailable"],
]);

const acceptsJson = (request: HttpServerRequest.HttpServerRequest) =>
  acceptedMediaTypes(request.headers.accept).some(
    (type) => type === "application/json" || type === "application/problem+json"
  );

export const errorPages = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* renderRequestError() {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const { pathname } = new URL(request.url, "https://ratstack.sh");
      const machine = machinePath(pathname) || acceptsJson(request);

      const response = yield* httpEffect.pipe(
        Effect.catchCause((cause) =>
          machine || Cause.hasInterrupts(cause)
            ? Effect.failCause(cause)
            : Effect.succeed(
                errorResponse(request, {
                  code: 500,
                  message: "Something went wrong. Please try again.",
                  path: pathname,
                  title: "Internal server error",
                })
              )
        )
      );

      const contentType = response.headers["content-type"] ?? "";

      if (
        machine ||
        response.status < 400 ||
        (Predicate.isTagged(response.body, "Uint8Array") &&
          new TextDecoder()
            .decode(response.body.body)
            .includes('class="error-code"')) ||
        (!contentType.startsWith("text/html") &&
          (response.status < 500 || !contentType.startsWith("text/plain")))
      ) {
        return response;
      }

      const page = errorResponse(request, {
        code: response.status,
        message:
          response.status >= 500
            ? "Something went wrong. Please try again."
            : "This request could not be completed.",
        path: pathname,
        title: errorTitles.get(response.status) ?? "Request failed",
      });

      return HttpServerResponse.setHeaders(page, {
        ...response.headers,
        "content-type":
          page.headers["content-type"] ?? "text/markdown; charset=utf-8",
      });
    }),
  { global: true }
);

const securityHeadersMiddleware = HttpRouter.middleware(
  (httpEffect) =>
    httpEffect.pipe(
      Effect.map((response) => {
        const contentType = response.headers["content-type"] ?? "";

        const secured = HttpServerResponse.setHeaders(
          response,
          securityHeaders
        ).pipe(
          HttpServerResponse.setHeaders(
            response.status >= 500
              ? { "cache-control": "no-store" }
              : response.headers
          )
        );

        const embeddable = contentType.startsWith("image/")
          ? HttpServerResponse.setHeader(
              secured,
              "cross-origin-resource-policy",
              "cross-origin"
            )
          : secured;

        return contentType.startsWith("text/html")
          ? HttpServerResponse.setHeaders(embeddable, {
              "cache-control":
                response.status >= 500
                  ? "no-store"
                  : (response.headers["cache-control"] ??
                    htmlRevalidateEveryVisit),
              "content-security-policy":
                response.headers["content-security-policy"] ??
                contentSecurityPolicy("'none'"),
            })
          : embeddable;
      })
    ),
  { global: true }
);

export interface WebBotAuthOptions {
  readonly enabled: boolean;
  readonly privateJwk?: string | undefined;
}

export interface MischiefRouteOptions {
  readonly contentStore?: ContentStore["Service"] | undefined;
  readonly assets?: StaticAssets["Service"] | undefined;
  readonly interest?: Omit<InterestOptions, "rateLimits"> | undefined;
  readonly joinTokens?: Context.Context<InterestTokens> | undefined;
  readonly legacyMcp?: LegacyMcpRouter;
  readonly rateLimits?: RateLimits;
  readonly staticCache?: StaticResponseCache | undefined;
  readonly webBotAuth?: WebBotAuthOptions;
}

const webBotAuthResponse = (options: WebBotAuthOptions) => {
  if (!options.enabled) {
    return HttpServerResponse.text("Not found.\n", {
      contentType: "text/plain; charset=utf-8",
      status: 404,
    });
  }

  if (options.privateJwk === undefined) {
    return HttpServerResponse.text("Web Bot Auth key is not configured.\n", {
      contentType: "text/plain; charset=utf-8",
      status: 503,
    });
  }

  return decodeEd25519PrivateJwk(options.privateJwk).pipe(
    Effect.map((key) => json(publicKeyDirectory(key))),
    Effect.orElseSucceed(() =>
      HttpServerResponse.text("Web Bot Auth key is invalid.\n", {
        contentType: "text/plain; charset=utf-8",
        status: 503,
      })
    )
  );
};

const webBotAuthRoutes = (options: WebBotAuthOptions) =>
  HttpRouter.add(
    "GET",
    "/.well-known/http-message-signatures-directory",
    webBotAuthResponse(options)
  );

const contentRequests = (store: ContentStore["Service"]) =>
  HttpRouter.middleware<{
    provides: ContentStore;
    handles: AssetReadError | ResourceNotFound;
  }>()(
    (httpEffect) =>
      httpEffect.pipe(
        Effect.provideService(ContentStore, store),
        Effect.catchTags({
          AssetReadError: () =>
            HttpServerRequest.HttpServerRequest.pipe(
              Effect.map(unavailableResponse)
            ),
          ResourceNotFound: () =>
            Effect.succeed(
              HttpServerResponse.text("Not found.\\n", { status: 404 })
            ),
        })
      ),
    { global: true }
  );

export const mischiefRoutes = (options: MischiefRouteOptions = {}) =>
  Layer.unwrap(
    Effect.gen(function* buildMischiefRoutes() {
      const ambient = yield* Effect.serviceOption(StaticAssets);

      const assets =
        options.assets ??
        Option.getOrElse(ambient, () => StaticAssets.unavailable);

      const store =
        options.contentStore ??
        (yield* ContentStore.pipe(
          Effect.provide(
            contentLayer.pipe(
              Layer.provide(Layer.succeed(StaticAssets, assets))
            )
          )
        ));

      return Layer.mergeAll(
        unsubscribeRoutes,
        contentRoutes(),
        retiredInterestRoutes,
        joinRequestMiddleware({
          rateLimits: options.rateLimits,
          tokens: options.joinTokens,
        }),
        apiRoutes,
        options.interest === undefined
          ? Layer.empty
          : interestRoutes({
              ...options.interest,
              rateLimits: options.rateLimits,
            }),
        mcp,
        securityHeadersMiddleware,
        errorPages,
        options.rateLimits === undefined && options.legacyMcp === undefined
          ? Layer.empty
          : requestProtection(options),
        linkHeaders(store),
        options.staticCache === undefined
          ? Layer.empty
          : staticCaching(options.staticCache),
        webBotAuthRoutes(options.webBotAuth ?? { enabled: false }),
        assetRoutes(assets, store)
      ).pipe(
        Layer.provideMerge(contentRequests(store)),
        Layer.provideMerge(Layer.succeed(ContentStore, store)),
        Layer.provideMerge(privateHttpTracingLayer)
      );
    })
  );

export const routes = mischiefRoutes();
