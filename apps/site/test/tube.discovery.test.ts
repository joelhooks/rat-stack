import { expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { isReaderWebsiteRoute } from "../src/reader-website.js";
import { llmsText, sitemapXml } from "./content-fixture.js";
import { catalog, fixtureBytes } from "./generated-content.js";

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

it("every summarized Tube page is discoverable in the sitemap and live agent guide", () => {
  const sitemap = sitemapXml("https://ratstack.sh");
  const guide = llmsText("https://ratstack.sh");

  const routes = [
    ...sitemap.matchAll(
      /<loc>https:\/\/ratstack\.sh(?<route>\/tube\/[A-Za-z0-9_-]{11})<\/loc>/gu
    ),
  ].map((match) => match.groups?.route ?? "");

  expect(routes).toHaveLength(53);

  for (const route of routes) {
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
