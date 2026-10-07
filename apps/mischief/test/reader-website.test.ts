import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import {
  forwardsToReaderWebsite,
  readerWebsiteRoutes,
  withReaderWebsite,
} from "../src/reader-website.js";

const readerPages = new Set(
  readerWebsiteRoutes.filter((route) => !route.endsWith("/*"))
);

const pathSchema = Schema.Union([
  Schema.Literals([
    "/",
    "/lore/services-capture-dependencies",
    "/prompts",
    "/prompts/example",
    "/learn",
    "/mcp",
    "/llms.txt",
    "/.well-known/mcp.json",
    "//unconverted",
    "//assets/x.js",
    "/assets/main-abc123.js",
  ]),
  Schema.String,
]);

const acceptSchema = Schema.Literals([
  "text/html",
  "text/html; charset=utf-8",
  "TEXT/HTML",
  "text/html;q=0",
  "text/markdown",
  "text/markdown, text/html;q=0",
  "*/*",
  "application/json",
  "",
]);

const website = {
  // oxlint-disable-next-line typescript/promise-function-async -- The service binding stub returns Cloudflare's native Promise.
  fetch: (request: Request) =>
    Promise.resolve(
      new Response("Foldkit", {
        headers: { "x-forwarded-url": request.url },
        status: 201,
      })
    ),
};

const route = withReaderWebsite(website)(
  Effect.succeed(
    HttpServerResponse.text("Mischief", {
      headers: { "x-mischief": "true" },
    })
  )
);

it.effect.prop(
  "forwards only allow-listed HTML pages or Website assets",
  { accept: acceptSchema, path: pathSchema },
  ({ accept, path }) =>
    Effect.gen(function* checkRouting() {
      const url = new URL("https://ratstack.sh");
      url.pathname = path.startsWith("/") ? path : `/${path}`;

      const request = new Request(url, {
        headers: { accept },
      });

      const actualPath = new URL(request.url).pathname;

      const expected =
        actualPath.startsWith("/assets/") ||
        (readerPages.has(actualPath) &&
          ["text/html", "text/html; charset=utf-8", "TEXT/HTML"].includes(
            accept
          ));

      const response = yield* route.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(request)
        )
      );

      expect(response.status).toBe(expected ? 201 : 200);
      expect(response.headers["x-mischief"]).toBe(
        expected ? undefined : "true"
      );

      if (expected) {
        expect(response.headers["x-forwarded-url"]).toBe(request.url);
        expect(response.headers.vary).toContain("Accept");
      }
    })
);

it.effect("keeps the reader, asset, and agent seams separate", () =>
  Effect.gen(function* checkSeams() {
    for (const [path, accept, expected] of [
      ["/", "text/html", 201],
      ["/?source=reader", "text/html", 201],
      ["/", "*/*", 200],
      ["/", "text/markdown", 200],
      ["/assets/x.js", "*/*", 201],
      ["/mcp", "text/html", 200],
      ["/llms.txt", "text/html", 200],
    ] as const) {
      const request = new Request(`https://ratstack.sh${path}`, {
        headers: { accept },
      });

      const response = yield* route.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(request)
        )
      );

      expect(response.status).toBe(expected);
    }
  })
);

it.prop(
  "an empty allow-list disables pages and assets",
  {
    accept: acceptSchema,
    path: pathSchema,
  },
  ({ accept, path }) => {
    expect(forwardsToReaderWebsite(path, accept, [])).toBe(false);
  }
);

it.effect(
  "agents and the kill switch do not require a working Website binding",
  () =>
    Effect.gen(function* checkBindingIsolation() {
      const missing = Effect.die("Website must not be touched");

      const fallback = Effect.succeed(
        HttpServerResponse.empty({ status: 204 })
      );

      for (const [path, accept, routes] of [
        ["/", "text/markdown", ["/", "/assets/*"]],
        ["/mcp", "text/html", ["/", "/assets/*"]],
        ["/", "text/html", []],
        ["/assets/x.js", "*/*", []],
      ] as const) {
        const request = new Request(`https://ratstack.sh${path}`, {
          headers: { accept },
        });

        const response = yield* withReaderWebsite(
          missing,
          routes
        )(fallback).pipe(
          Effect.provideService(
            HttpServerRequest.HttpServerRequest,
            HttpServerRequest.fromWeb(request)
          )
        );

        expect(response.status).toBe(204);
      }
    })
);

it("supports future route families without broad prefix matches", () => {
  const routes = ["/prompts", "/prompts/*", "/learn"];
  expect(forwardsToReaderWebsite("/prompts/example", "text/html", routes)).toBe(
    true
  );
  expect(forwardsToReaderWebsite("/promptspam", "text/html", routes)).toBe(
    false
  );
  expect(forwardsToReaderWebsite("/learn", "text/markdown", routes)).toBe(
    false
  );
});
