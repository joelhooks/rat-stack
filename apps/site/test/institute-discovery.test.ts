import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { mischiefRoutes } from "../src/app.js";
import { ContentStore } from "../src/content-store.js";
import { robotsText, sitemapXml } from "../src/content.js";
import { withInstituteNav } from "../src/institute-discovery.js";
import { instituteVisibilityFor } from "../src/institute-visibility.js";
import { nodeAssetsLayer } from "../src/node-content.js";
import { TestSandbox } from "./test-sandbox.js";

const request = (path: string) =>
  HttpServerRequest.fromWeb(new Request(`https://ratstack.sh${path}`));

it.layer(ContentStore.layer.pipe(Layer.provide(nodeAssetsLayer)))((test) => {
  test.effect(
    "only public Institute discovers the sitemap fragment in the site's sitemap index and robots",
    () =>
      Effect.gen(function* discovery() {
        const store = yield* ContentStore;
        const catalog = yield* store.catalog;
        const originalSitemap = sitemapXml("https://ratstack.sh", catalog);

        for (const bindings of [
          { INSTITUTE_ENABLED: "false", INSTITUTE_PUBLIC: "true" },
          { INSTITUTE_ENABLED: "true", INSTITUTE_PUBLIC: "false" },
          { INSTITUTE_ENABLED: "true", INSTITUTE_PUBLIC: "true" },
        ]) {
          const { discoverable } = instituteVisibilityFor(bindings);

          const app = yield* HttpRouter.toHttpEffect(
            mischiefRoutes({
              contentStore: store,
              instituteDiscoverable: discoverable,
            }).pipe(Layer.provide(TestSandbox))
          );

          const fetch = (path: string) =>
            app.pipe(
              Effect.provideService(
                HttpServerRequest.HttpServerRequest,
                request(path)
              ),
              Effect.map(HttpServerResponse.toWeb),
              Effect.flatMap((response) =>
                Effect.promise(response.text.bind(response))
              )
            );

          const sitemap = yield* fetch("/sitemap.xml");
          const robots = yield* fetch("/robots.txt");

          if (discoverable) {
            expect(sitemap).toContain("<sitemapindex ");
            expect(sitemap).toContain(
              "<loc>https://ratstack.sh/institute/sitemap.xml</loc>"
            );
            expect(sitemap).toContain(
              "<loc>https://ratstack.sh/sitemap/site.xml</loc>"
            );
            expect(yield* fetch("/sitemap/site.xml")).toBe(originalSitemap);
            expect(robots).toBe(
              `${robotsText}Sitemap: https://ratstack.sh/institute/sitemap.xml\n`
            );
          } else {
            expect(sitemap).toBe(originalSitemap);
            expect(robots).toBe(robotsText);
            expect(sitemap).not.toContain("institute");
            expect(robots).not.toContain("institute");
          }
        }
      })
  );
});

it.effect("unlisted Institute leaves existing navigation byte-identical", () =>
  Effect.gen(function* unlistedNavigation() {
    const nav =
      '<nav aria-label="Primary navigation"><div class="site-links"><ul><li><a href="/news">news</a></li></ul></div></nav>';

    const original = HttpServerResponse.html(nav);

    const response = yield* withInstituteNav(false)(
      Effect.succeed(original)
    ).pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, request("/"))
    );

    expect(response).toBe(original);
    const web = HttpServerResponse.toWeb(response);
    const body = yield* Effect.promise(web.text.bind(web));
    expect(body).toBe(nav);
    expect(body).not.toContain("institute");
  })
);
