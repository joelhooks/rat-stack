import { expect, it } from "@effect/vitest";
import { IntakeTicket } from "@rat-stack/core/intake";
import { Effect, Layer, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { HttpRouter } from "effect/http";

import { mischiefRoutes } from "../src/app.js";
import {
  staticAssetGeneration,
  tokenmaxxCopyScriptHash,
} from "../src/bundled-content.generated.js";
import { linkHeaderForPage } from "../src/content.js";
import { StaticAssets } from "../src/static-assets.js";
import { TestSandbox } from "./test-sandbox.js";

// oxlint-disable-next-line typescript/promise-function-async -- The native ASSETS fixture implements the platform Promise API.
const fetchFixture = (calls: string[], request: Request): Promise<Response> => {
  const path = new URL(request.url).pathname;
  calls.push(path);

  const body = path.endsWith(".html")
    ? "ASSET HTML __RATSTACK_ORIGIN__"
    : "ASSET MARKDOWN";

  return Promise.resolve(
    new Response(body, {
      headers: {
        "cache-control": "private",
        "set-cookie": "should-not-leak=yes",
      },
    })
  );
};

// oxlint-disable-next-line typescript/promise-function-async -- The missing-asset fixture implements the platform Promise API.
const fetchMissing = (): Promise<Response> =>
  Promise.resolve(new Response(null, { status: 404 }));

// oxlint-disable-next-line typescript/promise-function-async -- This fixture matches the native Cache API.
const cacheMiss = (): Promise<Response | undefined> =>
  // oxlint-disable-next-line unicorn/no-useless-undefined -- An explicit miss preserves the native API Promise type rather than Promise<void>.
  Promise.resolve<Response | undefined>(undefined);

// oxlint-disable-next-line typescript/promise-function-async -- A populated Cache API fixture must not conceal a missing asset.
const cacheHit = (): Promise<Response | undefined> =>
  Promise.resolve(
    new Response("Old cached representation", {
      headers: { "content-type": "text/markdown" },
    })
  );

// oxlint-disable-next-line typescript/promise-function-async -- This fixture matches the native Cache API.
const cachePut = (): Promise<void> => Promise.resolve();

// oxlint-disable-next-line typescript/promise-function-async -- Native binding fixtures expose Promise-returning fetch.
const fetchFailure = (
  reason: "response" | "empty" | "provider"
): Promise<Response> =>
  reason === "provider"
    ? Promise.reject(new Error("Asset provider unavailable"))
    : Promise.resolve(
        new Response("", { status: reason === "response" ? 404 : 200 })
      );

it.effect.prop(
  "keeps misses, empty bodies and provider failures typed",
  {
    reason: Arbitrary.schema(
      Schema.Literals(["response", "empty", "provider"])
    ),
  },
  ({ reason }) =>
    Effect.gen(function* typedAssetFailures() {
      const service = yield* StaticAssets.pipe(
        Effect.provide(
          StaticAssets.layer({ fetch: fetchFailure.bind(undefined, reason) })
        )
      );

      const error = yield* service.read("/index.html").pipe(Effect.flip);
      expect(error._tag).toBe("AssetReadError");
      expect(error.reason).toBe(reason);
      expect(error.path).toBe("/index.html");

      const unavailable = yield* StaticAssets.unavailable
        .read("/index.html")
        .pipe(Effect.flip);

      expect(unavailable.reason).toBe("binding");
    })
);

const withAssetHandler = <A, E, R>(
  use: (
    handler: (request: Request) => Promise<Response>,
    calls: string[]
  ) => Effect.Effect<A, E, R>,
  missing = false
) =>
  Effect.gen(function* runAssetAdapter() {
    const calls: string[] = [];

    const assets = yield* StaticAssets.pipe(
      Effect.provide(
        StaticAssets.layer({
          fetch: missing ? fetchMissing : fetchFixture.bind(undefined, calls),
        })
      )
    );

    return yield* Effect.acquireUseRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(
          mischiefRoutes({
            assets,
            staticCache: {
              match: missing ? cacheHit : cacheMiss,
              put: cachePut,
            },
          }).pipe(
            Layer.provide(TestSandbox),
            Layer.provide(IntakeTicket.testLayer)
          ),
          { disableLogger: true }
        )
      ),
      ({ handler }) => use(handler, calls),
      ({ dispose }) => Effect.promise(dispose)
    );
  });

it.effect("negotiates asset views without leaking native asset headers", () =>
  withAssetHandler((handler, calls) =>
    Effect.gen(function* negotiatedAssets() {
      for (const accept of [
        "",
        "*/*",
        "application/json",
        "text/markdown",
        "text/html;q=0",
        "TEXT/HTML",
      ]) {
        const response = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request("https://ratstack.sh/", { headers: { accept } })
          )
        );

        const isHtml = accept === "TEXT/HTML";
        expect(yield* Effect.promise(response.text.bind(response))).toBe(
          isHtml ? "ASSET HTML https://ratstack.sh" : "ASSET MARKDOWN"
        );
        expect(response.headers.get("vary")).toBe("Accept");
        expect(response.headers.get("link")).toBe(linkHeaderForPage("/"));
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(response.headers.get("x-fence")).toBe("electrified");
        expect(calls.at(-1)).toBe(isHtml ? "/index.html" : "/index.md");

        if (isHtml) {
          expect(response.headers.get("cache-control")).toBe("no-cache");
          expect(response.headers.get("content-security-policy")).toContain(
            tokenmaxxCopyScriptHash
          );
        }
      }

      for (const [path, expected, canonical] of [
        ["/index.md", "/index.md", "/"],
        ["/lore/cartridges.md", "/lore/cartridges.md", "/lore/cartridges"],
        ["/AGENTS.md", "/AGENTS.md.html", "/AGENTS.md"],
      ]) {
        const response = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request(`https://ratstack.sh${path}`, {
              headers: { accept: "text/html" },
            })
          )
        );

        expect(response.status).toBe(200);
        expect(calls.at(-1)).toBe(expected);
        expect(response.headers.get("link")).toBe(
          linkHeaderForPage(canonical ?? "/")
        );
      }

      const crawler = yield* Effect.promise(
        handler.bind(
          undefined,
          new Request("https://ratstack.sh/", {
            headers: { "user-agent": "Twitterbot/1.0" },
          })
        )
      );

      expect(crawler.headers.get("content-type")).toContain("text/html");
      expect(calls.at(-1)).toBe("/index.html");
    })
  )
);

it.effect(
  "keeps per-type asset cache lifetimes across GET, HEAD and validators",
  () =>
    withAssetHandler((handler) =>
      Effect.gen(function* assetCachePolicies() {
        const standard =
          "public, max-age=14400, s-maxage=31536000, stale-while-revalidate=86400";

        for (const [path, accept, policy] of [
          ["/lore/cartridges", "text/markdown", standard],
          ["/og/home.png", "image/png", standard],
          [
            "/tokenmaxx/four-comma-club.jpg",
            "image/jpeg",
            "public, max-age=86400",
          ],
          [
            "/lore/cartridges/snes-sfam-cartridges.jpg",
            "image/jpeg",
            "public, max-age=86400",
          ],
          ["/favicon.ico", "image/x-icon", standard],
          ["/", "text/html", "no-cache"],
        ]) {
          const get = yield* Effect.promise(
            handler.bind(
              undefined,
              new Request(`https://ratstack.sh${path}`, { headers: { accept } })
            )
          );

          expect(get.status).toBe(200);
          expect(get.headers.get("cache-control"), path).toBe(policy);

          for (const method of ["GET", "HEAD"]) {
            const conditional = yield* Effect.promise(
              handler.bind(
                undefined,
                new Request(`https://ratstack.sh${path}`, {
                  headers: {
                    accept,
                    "if-none-match": get.headers.get("etag") ?? "",
                  },
                  method,
                })
              )
            );

            expect(conditional.status).toBe(304);
            expect(conditional.headers.get("cache-control"), path).toBe(policy);
          }

          const head = yield* Effect.promise(
            handler.bind(
              undefined,
              new Request(`https://ratstack.sh${path}`, {
                headers: { accept },
                method: "HEAD",
              })
            )
          );

          expect(head.status).toBe(200);
          expect(head.headers.get("cache-control"), path).toBe(policy);
          expect(yield* Effect.promise(head.text.bind(head))).toBe("");
        }
      })
    )
);

it.effect(
  "keeps HEAD, validators, tickets and capability routing inside HTTP composition",
  () =>
    withAssetHandler((handler, calls) =>
      Effect.gen(function* guardedAssetRoutes() {
        const first = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request("https://ratstack.sh/", {
              headers: { accept: "text/html" },
            })
          )
        );

        expect(first.headers.get("etag")).toContain(staticAssetGeneration);

        const conditional = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request("https://ratstack.sh/", {
              headers: {
                accept: "text/html",
                "if-none-match": first.headers.get("etag") ?? "",
              },
            })
          )
        );

        expect(conditional.status).toBe(304);
        expect(conditional.headers.get("cache-control")).toBe("no-cache");
        expect(yield* Effect.promise(conditional.text.bind(conditional))).toBe(
          ""
        );

        const head = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request("https://ratstack.sh/", {
              headers: { accept: "text/html" },
              method: "HEAD",
            })
          )
        );

        expect(head.status).toBe(200);
        expect(yield* Effect.promise(head.text.bind(head))).toBe("");

        const before = calls.length;

        const md1 = yield* Effect.promise(
          handler.bind(undefined, new Request("https://ratstack.sh/tokenmaxx"))
        );

        const md2 = yield* Effect.promise(
          handler.bind(undefined, new Request("https://ratstack.sh/tokenmaxx"))
        );

        expect(yield* Effect.promise(md1.text.bind(md1))).not.toBe(
          yield* Effect.promise(md2.text.bind(md2))
        );
        expect(md1.headers.get("cache-control")).toBe("no-store");
        expect(md2.headers.get("cache-control")).toBe("no-store");

        for (const path of [
          "/openapi.json",
          "/api/unknown",
          "/mcp",
          "/not-a-page",
          "/index.html",
        ]) {
          const response = yield* Effect.promise(
            handler.bind(undefined, new Request(`https://ratstack.sh${path}`))
          );

          expect(response.headers.get("x-ratstack-cache")).toBe(
            path === "/openapi.json" ? "MISS" : null
          );
        }

        expect(calls).toHaveLength(before);
      })
    )
);

it.effect("fails visibly without caching when the asset binding misses", () =>
  withAssetHandler(
    (handler) =>
      Effect.gen(function* unavailableStaticContent() {
        for (const path of [
          "/",
          "/lore/cartridges",
          "/lore/cartridges.md",
          "/og/home.png",
          "/favicon.ico",
        ]) {
          const response = yield* Effect.promise(
            handler.bind(
              undefined,
              new Request(`https://ratstack.sh${path}`, {
                headers: {
                  accept: path.endsWith(".md") ? "text/html" : "text/markdown",
                  "if-none-match": "*",
                },
              })
            )
          );

          const body = yield* Effect.promise(response.text.bind(response));

          expect(response.status).toBe(503);
          expect(response.headers.get("vary")).toBe("Accept");
          expect(response.headers.get("cache-control")).toBe("no-store");
          expect(body).toContain("Static content is unavailable");
          expect(body).not.toContain("ASSET HTML");

          if (path.endsWith(".md")) {
            expect(response.headers.get("content-type")).toContain(
              "text/markdown"
            );
          } else {
            expect(body).toContain("Service unavailable");
            expect(response.headers.get("cache-control")).toBe("no-store");
          }
        }
      }),
    true
  )
);
