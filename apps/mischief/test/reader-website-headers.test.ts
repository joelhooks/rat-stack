import { expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";

import { readerResponseHeaders } from "../src/app.js";
import { ContentStore } from "../src/content-store.js";
import { linkHeaderForPage } from "../src/content.js";
import { nodeAssetsLayer } from "../src/node-content.js";
import { withReaderWebsite } from "../src/reader-website.js";
import {
  readerContentSecurityPolicy,
  securityHeaders,
} from "../src/security.js";

const browserHeaders = [
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "permissions-policy",
  "referrer-policy",
  "strict-transport-security",
  "x-content-type-options",
  "x-fence",
  "x-frame-options",
] as const;

const securityHeaderValues: Readonly<Record<string, string>> = securityHeaders;

const forwardedPath = Schema.Struct({
  family: Schema.Literals([
    "/",
    "/learn",
    "/lore",
    "/lore/effect-basics",
    "/lore/",
    "/prompts",
    "/prompts/",
    "/assets/",
  ]),
  slug: Schema.String,
});

const websiteResponse = Schema.Struct({
  cacheControl: Schema.optional(
    Schema.Literals(["public, max-age=0, must-revalidate", "no-store"])
  ),
  contentType: Schema.Literals([
    "text/html",
    "text/html; charset=utf-8",
    "text/javascript",
    "text/css",
    "image/png",
    "application/json",
  ]),
  status: Schema.Literals([200, 301, 404, 500, 503]),
});

const pathFrom = ({ family, slug }: typeof forwardedPath.Type) =>
  family.endsWith("/") && family !== "/"
    ? `${family}${slug.replaceAll(/[^a-z0-9._-]/giu, "") || "x"}`
    : family;

it.layer(ContentStore.layer.pipe(Layer.provide(nodeAssetsLayer)))((test) => {
  test.effect.prop(
    "every forwarded HTML or asset response carries Mischief's security and discovery headers",
    { path: forwardedPath, upstream: websiteResponse },
    ({ path: generated, upstream }) =>
      Effect.gen(function* checkForwardedHeaders() {
        const store = yield* ContentStore;
        const catalog = yield* store.catalog;
        const path = pathFrom(generated);

        const upstreamHeaders = new Headers({
          "content-type": upstream.contentType,
        });

        if (upstream.cacheControl !== undefined) {
          upstreamHeaders.set("cache-control", upstream.cacheControl);
        }

        const website = {
          // oxlint-disable-next-line typescript/promise-function-async -- The service binding stub returns Cloudflare's native Promise.
          fetch: () =>
            Promise.resolve(
              new Response("Foldkit", {
                headers: upstreamHeaders,
                status: upstream.status,
              })
            ),
        };

        const response = yield* withReaderWebsite(
          website,
          readerResponseHeaders(store)
        )(Effect.die("Mischief must not render a forwarded path")).pipe(
          Effect.provideService(
            HttpServerRequest.HttpServerRequest,
            HttpServerRequest.fromWeb(
              new Request(`https://ratstack.sh${path}`, {
                headers: { accept: "text/html" },
              })
            )
          )
        );

        const image = upstream.contentType.startsWith("image/");
        const html = upstream.contentType.startsWith("text/html");

        for (const name of browserHeaders) {
          expect(response.headers[name]).toEqual(expect.any(String));
          expect(response.headers[name]).toBe(
            name === "cross-origin-resource-policy" && image
              ? "cross-origin"
              : securityHeaderValues[name]
          );
        }

        expect(response.headers.link).toBe(
          linkHeaderForPage(
            upstream.status < 500 && catalog.pageRoutes.includes(path)
              ? path
              : "/"
          )
        );

        expect(response.headers["content-security-policy"]).toBe(
          html ? readerContentSecurityPolicy : undefined
        );

        if (html || upstream.status >= 500) {
          expect(response.headers["cache-control"]).toBe(
            upstream.status >= 500
              ? "no-store"
              : (upstream.cacheControl ?? "no-cache")
          );
        }
      })
  );
});
