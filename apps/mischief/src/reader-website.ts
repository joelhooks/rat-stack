import { Effect } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { acceptsHtml } from "./negotiation.js";
import { readerContentSecurityPolicy, secureResponse } from "./security.js";
import type { AssetBinding } from "./static-assets.js";

export const readerWebsiteRoutes: readonly string[] = [
  "/",
  "/assets/*",
  "/AGENTS.md",
  "/directory",
  "/news",
  "/search",
  "/README.md",
  "/VISION.md",
  "/debt.md",
  "/glossary",
  "/log",
  "/log.md",
  "/pins.md",
  "/resources/effect-4-reference-projects",
  "/resources/lint-rule-limits",
  "/resources/peers",
  "/resources/same-version-repos",
  "/resources/schema-projections-and-code-mode",
  "/tokenmaxx",
  "/vendor/README.md",
  "/learn",
  "/lore",
  "/lore/*",
  "/prompts",
  "/prompts/*",
  "/systems",
  "/systems/*",
  "/skills",
  "/skills/*",
  "/rpc",
  "/rpc/*",
];

export const isReaderWebsiteRoute = (
  pathname: string,
  routes: readonly string[] = readerWebsiteRoutes
): boolean =>
  routes.some((route) =>
    route.endsWith("/*")
      ? pathname.startsWith(route.slice(0, -1))
      : pathname === route
  );

export type ReaderWebsiteTarget = "asset" | "mischief" | "page" | "rpc";

export const readerWebsiteTarget = (
  pathname: string,
  wantsHtml: boolean,
  routes: readonly string[] = readerWebsiteRoutes
): ReaderWebsiteTarget => {
  if (!isReaderWebsiteRoute(pathname, routes)) {
    return "mischief";
  }

  if (pathname === "/rpc" || pathname.startsWith("/rpc/")) {
    return "rpc";
  }

  if (pathname.startsWith("/assets/")) {
    return "asset";
  }

  return wantsHtml ? "page" : "mischief";
};

export const forwardsToReaderWebsite = (
  request: HttpServerRequest.HttpServerRequest,
  pathname: string,
  routes: readonly string[] = readerWebsiteRoutes
): boolean =>
  readerWebsiteTarget(pathname, acceptsHtml(request), routes) !== "mischief";

export type ReaderResponseHeaders = (
  pagePath: string,
  response: HttpServerResponse.HttpServerResponse
) => Effect.Effect<HttpServerResponse.HttpServerResponse>;

export const withReaderWebsite =
  (
    website: AssetBinding | Effect.Effect<AssetBinding>,
    responseHeaders: ReaderResponseHeaders,
    routes: readonly string[] = readerWebsiteRoutes
  ) =>
  <E, R>(
    fallback: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
  ) =>
    Effect.gen(function* routeReaderWebsite() {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const { pathname } = new URL(request.originalUrl, "https://ratstack.sh");

      const target = readerWebsiteTarget(
        pathname,
        acceptsHtml(request),
        routes
      );

      if (target === "mischief") {
        return yield* fallback;
      }

      const binding = Effect.isEffect(website) ? yield* website : website;

      const original = yield* HttpServerRequest.toWeb(request).pipe(
        Effect.orDie
      );

      if (target === "rpc") {
        const rpcResponse = yield* Effect.promise(
          binding.fetch.bind(binding, original)
        );

        return secureResponse(
          HttpServerResponse.fromWeb(rpcResponse),
          readerContentSecurityPolicy
        );
      }

      const forwardedHeaders = new Headers(original.headers);

      if (target === "page") {
        forwardedHeaders.set("accept", "text/html");
      }

      const webRequest = new Request(original, { headers: forwardedHeaders });

      const response = yield* Effect.promise(
        binding.fetch.bind(binding, webRequest)
      );

      if (response.status === 404) {
        if (response.body !== null) {
          yield* Effect.tryPromise(
            response.body.cancel.bind(response.body)
          ).pipe(Effect.ignore);
        }

        return yield* fallback;
      }

      const headers = new Headers(response.headers);
      const vary = headers.get("vary");
      headers.set("vary", vary === null ? "Accept" : `${vary}, Accept`);

      return yield* responseHeaders(
        pathname,
        HttpServerResponse.fromWeb(
          new Response(response.body, {
            headers,
            status: response.status,
            statusText: response.statusText,
          })
        )
      );
    });
