import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { acceptsHtml } from "../src/negotiation.js";
import {
  forwardsToReaderWebsite,
  readerWebsiteRoutes,
  withReaderWebsite,
} from "../src/reader-website.js";

const readerPages = new Set(
  readerWebsiteRoutes.filter((route) => !route.endsWith("/*"))
);

const readerFamilies = readerWebsiteRoutes
  .filter((route) => route.endsWith("/*"))
  .map((route) => route.split("/").slice(0, -1));

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
    "/rpc",
    "/rpc/",
    "/rpc/search",
    "/rpcx",
    "/rpc.json",
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

const bodyMethodSchema = Schema.Literals([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

const methodSchema = Schema.Union([
  Schema.Literals(["GET", "HEAD"]),
  bodyMethodSchema,
]);

const carriesBody = Schema.is(bodyMethodSchema);

const isRpcPath = (pathname: string) =>
  pathname === "/rpc" || pathname.startsWith("/rpc/");

const userAgentSchema = Schema.Literals([
  "",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  "Twitterbot/1.0",
  "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  "curl/8.9.1",
]);

const serverRequest = (path: string, accept: string, userAgent = "") =>
  HttpServerRequest.fromWeb(
    new Request(`https://ratstack.sh${path}`, {
      headers: { accept, "user-agent": userAgent },
    })
  );

const website = {
  // oxlint-disable-next-line typescript/promise-function-async -- The service binding stub returns Cloudflare's native Promise.
  fetch: (request: Request) =>
    request.text().then(
      (body) =>
        new Response("Foldkit", {
          headers: {
            "x-forwarded-accept": request.headers.get("accept") ?? "",
            "x-forwarded-body": body,
            "x-forwarded-method": request.method,
            "x-forwarded-url": request.url,
          },
          status: 201,
        })
    ),
};

const unchanged = (
  _pagePath: string,
  response: HttpServerResponse.HttpServerResponse
) => Effect.succeed(response);

const route = withReaderWebsite(
  website,
  unchanged
)(
  Effect.succeed(
    HttpServerResponse.text("Mischief", {
      headers: { "x-mischief": "true" },
    })
  )
);

it.effect.prop(
  "forwards allow-listed pages exactly when Mischief would answer HTML, plus Website assets and every RPC call intact",
  {
    accept: acceptSchema,
    method: methodSchema,
    path: pathSchema,
    userAgent: userAgentSchema,
  },
  ({ accept, method, path, userAgent }) =>
    Effect.gen(function* checkRouting() {
      const url = new URL("https://ratstack.sh");
      url.pathname = path.startsWith("/") ? path : `/${path}`;

      const headers = { accept, "user-agent": userAgent };

      const body = `[${method.toLowerCase()}]`;

      const init = { headers, method };

      const request = new Request(
        url,
        carriesBody(method) ? { ...init, body } : init
      );

      const actualPath = new URL(request.url).pathname;

      const segments = actualPath.split("/");

      const readerPath =
        readerPages.has(actualPath) ||
        readerFamilies.some(
          (family) =>
            segments.length > family.length &&
            family.every((segment, index) => segment === segments[index])
        );

      const asset = actualPath.startsWith("/assets/");

      const rpc = isRpcPath(actualPath);

      const expected =
        asset ||
        rpc ||
        (readerPath && acceptsHtml(HttpServerRequest.fromWeb(request)));

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
        expect(response.headers["x-forwarded-method"]).toBe(method);
        expect(response.headers["x-forwarded-body"]).toBe(
          carriesBody(method) ? body : ""
        );
        expect(response.headers["x-forwarded-accept"]).toBe(
          asset || rpc ? accept : "text/html"
        );
      }

      if (expected && !rpc) {
        expect(response.headers.vary).toContain("Accept");
      }
    })
);

it.effect("keeps the reader, asset, and agent seams separate", () =>
  Effect.gen(function* checkSeams() {
    for (const [path, accept, userAgent, expected] of [
      ["/", "text/html", "", 201],
      ["/?source=reader", "text/html", "", 201],
      ["/", "*/*", "", 200],
      ["/", "*/*", "Slackbot-LinkExpanding 1.0", 201],
      ["/", "*/*", "Mozilla/5.0", 201],
      ["/", "*/*", "Mozilla/5.0 (compatible; GPTBot/1.2)", 200],
      ["/", "text/markdown", "Mozilla/5.0", 200],
      ["/assets/x.js", "*/*", "", 201],
      ["/mcp", "text/html", "", 200],
      ["/llms.txt", "text/html", "", 200],
    ] as const) {
      const response = yield* route.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          serverRequest(path, accept, userAgent)
        )
      );

      expect(response.status).toBe(expected);
    }
  })
);

it.effect(
  "a browser search POST /rpc reaches the Website with its JSON body",
  () =>
    Effect.gen(function* checkRpcSeam() {
      const body = JSON.stringify({ query: "cartridge" });

      const response = yield* route.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromWeb(
            new Request("https://ratstack.sh/rpc", {
              body,
              headers: {
                accept: "application/json",
                "content-type": "application/json",
              },
              method: "POST",
            })
          )
        )
      );

      expect(response.status).toBe(201);
      expect(response.headers["x-mischief"]).toBeUndefined();
      expect(response.headers["x-forwarded-method"]).toBe("POST");
      expect(response.headers["x-forwarded-accept"]).toBe("application/json");
      expect(response.headers["x-forwarded-body"]).toBe(body);
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
    })
);

it.prop(
  "an empty allow-list disables pages and assets",
  {
    accept: acceptSchema,
    path: pathSchema,
    userAgent: userAgentSchema,
  },
  ({ accept, path, userAgent }) => {
    expect(
      forwardsToReaderWebsite(serverRequest("/", accept, userAgent), path, [])
    ).toBe(false);
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
        ["/rpc", "application/json", []],
      ] as const) {
        const request = new Request(`https://ratstack.sh${path}`, {
          headers: { accept },
        });

        const response = yield* withReaderWebsite(
          missing,
          unchanged,
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
  const html = serverRequest("/", "text/html");
  expect(forwardsToReaderWebsite(html, "/prompts/example", routes)).toBe(true);
  expect(forwardsToReaderWebsite(html, "/promptspam", routes)).toBe(false);
  expect(
    forwardsToReaderWebsite(
      serverRequest("/", "text/markdown"),
      "/learn",
      routes
    )
  ).toBe(false);
});
