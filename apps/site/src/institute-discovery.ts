import { Effect } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { institutePath, instituteSitemapPath } from "./institute-paths.js";

export const siteSitemapPath = "/sitemap/site.xml";

const origin = "https://ratstack.sh";

export const instituteRobotsDirective = `Sitemap: ${origin}${instituteSitemapPath}\n`;

export const instituteSitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${origin}${siteSitemapPath}</loc></sitemap>
  <sitemap><loc>${origin}${instituteSitemapPath}</loc></sitemap>
</sitemapindex>
`;

declare class HTMLRewriter {
  on(
    selector: string,
    handlers: {
      readonly element: (element: {
        readonly append: (
          markup: string,
          options: { readonly html: boolean }
        ) => void;
      }) => void;
    }
  ): this;
  transform(response: Response): Response;
}

const primaryLinks =
  'nav[aria-label="Primary navigation"] > .site-links > ul:first-child';

export const withInstituteNav =
  (discoverable: boolean) =>
  <E, R>(app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) => {
    if (!discoverable) {
      return app;
    }

    return Effect.gen(function* instituteNav() {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const response = yield* app;

      if (
        request.method !== "GET" ||
        response.status !== 200 ||
        response.headers["content-type"]?.startsWith("text/html") !== true
      ) {
        return response;
      }

      const transformed = new HTMLRewriter()
        .on(primaryLinks, {
          element: (list) => {
            list.append(`<li><a href="${institutePath}">institute</a></li>`, {
              html: true,
            });
          },
        })
        .transform(HttpServerResponse.toWeb(response));

      return HttpServerResponse.fromWeb(transformed);
    });
  };
