import { Effect } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import type { AssetBinding } from "./static-assets.js";

export const readerWebsiteRoutes: readonly string[] = [
  "/",
  "/assets/*",
  "/learn",
  "/lore",
  "/lore/*",
  "/prompts",
  "/prompts/*",
];

export const forwardsToReaderWebsite = (
  pathname: string,
  accept: string | undefined,
  routes: readonly string[] = readerWebsiteRoutes
): boolean =>
  routes.some((route) =>
    route.endsWith("/*")
      ? pathname.startsWith(route.slice(0, -1))
      : pathname === route
  ) &&
  (pathname.startsWith("/assets/") ||
    (accept ?? "").split(",").some((entry) => {
      const [mediaType, ...parameters] = entry.trim().toLowerCase().split(";");

      return (
        mediaType === "text/html" &&
        !parameters.some((parameter) => parameter.trim() === "q=0")
      );
    }));

export const withReaderWebsite =
  (
    website: AssetBinding | Effect.Effect<AssetBinding>,
    routes: readonly string[] = readerWebsiteRoutes
  ) =>
  <E, R>(
    fallback: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
  ) =>
    Effect.gen(function* routeReaderWebsite() {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const { pathname } = new URL(request.originalUrl, "https://ratstack.sh");

      if (!forwardsToReaderWebsite(pathname, request.headers.accept, routes)) {
        return yield* fallback;
      }

      const binding = Effect.isEffect(website) ? yield* website : website;

      const webRequest = yield* HttpServerRequest.toWeb(request).pipe(
        Effect.orDie
      );

      const response = yield* Effect.promise(
        binding.fetch.bind(binding, webRequest)
      );

      const headers = new Headers(response.headers);
      const vary = headers.get("vary");
      headers.set("vary", vary === null ? "Accept" : `${vary}, Accept`);

      return HttpServerResponse.fromWeb(
        new Response(response.body, {
          headers,
          status: response.status,
          statusText: response.statusText,
        })
      );
    });
