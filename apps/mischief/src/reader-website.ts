import { Effect } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { acceptsHtml } from "./negotiation.js";
import type { AssetBinding } from "./static-assets.js";

export const readerWebsiteRoutes: readonly string[] = [
  "/",
  "/assets/*",
  "/AGENTS.md",
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

export const forwardsToReaderWebsite = (
  request: HttpServerRequest.HttpServerRequest,
  pathname: string,
  routes: readonly string[] = readerWebsiteRoutes
): boolean =>
  isReaderWebsiteRoute(pathname, routes) &&
  (pathname.startsWith("/assets/") || acceptsHtml(request));

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

      if (!forwardsToReaderWebsite(request, pathname, routes)) {
        return yield* fallback;
      }

      const binding = Effect.isEffect(website) ? yield* website : website;

      const original = yield* HttpServerRequest.toWeb(request).pipe(
        Effect.orDie
      );

      const forwardedHeaders = new Headers(original.headers);

      if (!pathname.startsWith("/assets/")) {
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
