import { expect, it } from "@effect/vitest";
import { Schema } from "effect";

import tube from "../../../.brain/data/tube.json" with { type: "json" };
import { isReaderWebsiteRoute } from "../src/reader-website.js";
import { llmsText, sitemapXml } from "./content-fixture.js";
import {
  catalog,
  fixtureBytes,
  generatedReaderPage,
} from "./generated-content.js";

it("the concept gap list is a public raw JSON asset rather than an internal data envelope", () => {
  expect(catalog.imagePaths).toContain("/tube/gaps.json");

  const list = Schema.decodeSync(
    Schema.fromJsonString(
      Schema.Struct({
        gaps: Schema.Array(
          Schema.Struct({
            term: Schema.NonEmptyString,
            videos: Schema.Array(Schema.String),
          })
        ),
      })
    )
  )(fixtureBytes("/tube/gaps.json").toString("utf-8"));

  expect(list.gaps.length).toBeGreaterThan(0);

  for (const gap of list.gaps) {
    expect(gap.videos.length).toBeGreaterThan(0);

    for (const path of gap.videos) {
      expect(catalog.pageRoutes).toContain(path);
    }
  }
});

it("published video metadata and internal links use stored slugs, never id page paths", () => {
  const documents = [generatedReaderPage("/"), generatedReaderPage("/tube")];

  for (const video of tube.videos.filter((entry) => "page" in entry)) {
    const url = `https://ratstack.sh/tube/${video.slug}`;
    const html = generatedReaderPage(`/tube/${video.slug}`);
    expect(html).toContain(`rel="canonical" href="${url}"`);
    expect(html).toContain(`property="og:url" content="${url}"`);
    expect(html).toContain(`"url":"${url}"`);
    documents.push(html);
  }

  for (const html of documents) {
    for (const video of tube.videos) {
      expect(html).not.toContain(`/tube/${video.id}`);
    }
  }
});

it("every summarized Tube page is discoverable in the sitemap and live agent guide", () => {
  const sitemap = sitemapXml("https://ratstack.sh");
  const guide = llmsText("https://ratstack.sh");

  const routes = tube.videos
    .filter((video) => "page" in video)
    .map((video) => `/tube/${video.slug}`);

  for (const video of tube.videos) {
    expect(sitemap).not.toContain(`/tube/${video.id}`);
    expect(guide).not.toContain(`/tube/${video.id}`);
  }

  expect(routes.length).toBeGreaterThan(0);

  for (const route of routes) {
    expect(sitemap).toContain(`<loc>https://ratstack.sh${route}</loc>`);
    expect(guide).toContain(`https://ratstack.sh${route}`);
    expect(isReaderWebsiteRoute(route)).toBe(true);
  }

  for (const id of [
    "0naAPm0-0Wg",
    "LCEmiRjPEtQ",
    "75jxhU6z3ho",
    "VBsqp3NutAE",
  ]) {
    expect(sitemap).not.toContain(`/tube/${id}`);
    expect(guide).not.toContain(`/tube/${id}`);
  }

  expect(guide).toContain("https://ratstack.sh/tube/gaps.json");
});
