import { expect, it } from "@effect/vitest";
import { IntakeTicket } from "@rat-stack/core/intake";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { mischiefRoutes } from "../src/app.js";
import { tokenmaxxCopyScriptHash } from "../src/bundled-content.generated.js";
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
          mischiefRoutes({ assets }).pipe(
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

          expect(response.headers.get("x-ratstack-cache")).toBeNull();
        }

        expect(calls).toHaveLength(before);
      })
    )
);

it.effect("keeps inline content available when the asset binding misses", () =>
  withAssetHandler(
    (handler) =>
      Effect.gen(function* inlineAssetFallback() {
        for (const path of ["/", "/lore/cartridges", "/lore/cartridges.md"]) {
          const response = yield* Effect.promise(
            handler.bind(
              undefined,
              new Request(`https://ratstack.sh${path}`, {
                headers: { accept: "text/html" },
              })
            )
          );

          const body = yield* Effect.promise(response.text.bind(response));

          expect(response.status).toBe(200);
          expect(response.headers.get("vary")).toBe("Accept");
          expect(body).not.toContain("ASSET HTML");

          if (path.endsWith(".md")) {
            expect(response.headers.get("content-type")).toContain(
              "text/markdown"
            );
          } else {
            expect(body).toContain("<!doctype html>");
            expect(response.headers.get("cache-control")).toBe("no-cache");
          }
        }
      }),
    true
  )
);
