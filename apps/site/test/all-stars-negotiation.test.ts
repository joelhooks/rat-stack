import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { mischiefRoutes, readerResponseHeaders } from "../src/app.js";
import { ContentStore } from "../src/content-store.js";
import { nodeAssetsLayer } from "../src/node-content.js";
import { withReaderWebsite } from "../src/reader-website.js";
import { TestSandbox } from "./test-sandbox.js";

const website = {
  fetch: () =>
    Promise.resolve(
      new Response("<!doctype html><h1>Website</h1>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    ),
};

const cases = [
  {
    contains: ["/all-stars/sam-goodwin", "alchemy-run/alchemy", "stars"],
    path: "/all-stars",
  },
  {
    contains: ["/all-stars/devinjameson", "foldkit/foldkit", "stars"],
    path: "/all-stars.md",
  },
  {
    contains: ["github.com/devinjameson", "foldkit/foldkit-domains", "stars"],
    path: "/all-stars/devinjameson",
  },
  {
    contains: ["github.com/sam-goodwin", "alchemy-run/alchemy"],
    path: "/all-stars/sam-goodwin.md",
  },
] as const;

it.layer(ContentStore.layer.pipe(Layer.provide(nodeAssetsLayer)))((test) => {
  test.effect(
    "agents asking the production composition for all stars get Markdown, and browsers get the Website page",
    () =>
      Effect.gen(function* negotiateAllStars() {
        const store = yield* ContentStore;

        const mischief = yield* HttpRouter.toHttpEffect(
          mischiefRoutes().pipe(Layer.provide(TestSandbox))
        );

        const routed = withReaderWebsite(
          website,
          readerResponseHeaders(store)
        )(mischief);

        const fetch = (path: string, accept: string) =>
          routed.pipe(
            Effect.provideService(
              HttpServerRequest.HttpServerRequest,
              HttpServerRequest.fromWeb(
                new Request(`https://ratstack.sh${path}`, {
                  headers: { accept },
                })
              )
            ),
            Effect.map(HttpServerResponse.toWeb),
            Effect.flatMap((response) =>
              Effect.promise(response.text.bind(response)).pipe(
                Effect.map((body) => ({
                  body,
                  contentType: response.headers.get("content-type"),
                  status: response.status,
                }))
              )
            )
          );

        for (const { contains, path } of cases) {
          const markdown = yield* fetch(path, "text/markdown");

          expect(markdown.status).toBe(200);
          expect(markdown.contentType).toBe("text/markdown; charset=utf-8");

          for (const text of contains) {
            expect(markdown.body).toContain(text);
          }

          expect(markdown.body).toContain("To be removed from this page");
          expect(markdown.body).not.toContain("<h1>Website</h1>");
        }

        const browser = yield* fetch("/all-stars", "text/html");

        expect(browser.body).toContain("<h1>Website</h1>");
      }).pipe(Effect.scoped)
  );
});
