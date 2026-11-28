import { ssr } from "@effect/ui/html/testing";
import { TestHost } from "@effect/ui/testing";
import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { InstitutePage } from "../src/institute/routes/component.js";
import {
  InstituteHandoff,
  instituteHandoffId,
} from "../src/institute/routes/model.js";
import { renderInstituteRequest } from "../src/institute/routes/request.js";
import { renderDocument } from "../src/server/reader-document.js";

const assets = {
  entryScript: "/assets/institute-test.js",
  modulePreloads: [],
  stylesheets: [],
};

const summary = (id: string, title: string, order: number) => ({
  description: title,
  id,
  order,
  title,
});

const published = summary("one-contract", "One contract, every surface", 3);

const transcript = "A boundary keeps </script><mark> in the transcript.";

const files = new Map<string, unknown>([
  [
    "/institute/content/manifest.json",
    {
      chapters: [
        summary("intro", "Introduction to Effect", 1),
        { ...summary("one-boundary", "Unpublished", 2), draft: true },
        published,
        { ...summary("the-fence", "Not ready", 4), comingSoon: true },
      ],
    },
  ],
  [
    "/institute/content/one-contract/manifest.json",
    {
      id: "one-contract",
      sections: [
        { file: "bind-behavior.01234567.json", id: "bind-behavior" },
        { file: "define-boundary.12345678.json", id: "define-boundary" },
        { file: "people-surfaces.23456789.json", id: "people-surfaces" },
      ],
    },
  ],
  [
    "/institute/content/one-contract/define-boundary.12345678.json",
    {
      audioFile: "define-boundary.01234567.webm",
      id: "define-boundary",
      text: transcript,
    },
  ],
  [
    "/institute/content/one-contract/bind-behavior.01234567.json",
    {
      id: "bind-behavior",
      text: "This section has no narration yet.",
    },
  ],
]);

const read = (path: string, discoverable = true) =>
  renderInstituteRequest(
    new Request(`https://preview.test${path}`),
    (request) => {
      const file = files.get(new URL(request.url).pathname);

      return Promise.resolve(
        file === undefined
          ? new Response(null, { status: 404 })
          : Response.json(file)
      );
    },
    assets,
    discoverable
  );

const documentFor = (path: string, discoverable = true) =>
  read(path, discoverable).pipe(
    Effect.map((result) => {
      if (result?.application === undefined) {
        throw new Error(`Expected Institute HTML at ${path}`);
      }

      return new DOMParser().parseFromString(
        renderDocument(result.application, assets),
        "text/html"
      );
    })
  );

it.effect(
  "publishes only Ratstack chapters and gives Kit's chapters outbound credit",
  () =>
    Effect.gen(function* courseHome() {
      const home = yield* documentFor("/institute");

      const listing = [...home.querySelectorAll("ol a")].map((link) =>
        link.getAttribute("href")
      );

      expect(listing).toEqual(["/institute/chapters/one-contract"]);
      expect(
        home.querySelector(
          'a[href="https://www.effect.institute/chapters/basics"]'
        )?.textContent
      ).toBe("Effect Basics");
      expect(
        home.querySelector('link[rel="canonical"]')?.getAttribute("href")
      ).toBe("https://ratstack.sh/institute");
      expect(
        home
          .querySelector('meta[name="twitter:image"]')
          ?.getAttribute("content")
      ).toBe("https://ratstack.sh/institute/og/home.png");
      expect(yield* read("/institute/chapters/intro")).toBeNull();
      expect(yield* read("/institute/chapters/one-boundary")).toBeNull();
      expect(
        yield* read("/institute/content/intro/welcome.12345678.json")
      ).toBeNull();

      const fragment = yield* read("/institute/sitemap.xml");

      const response = fragment?.response;

      if (response === undefined) {
        throw new Error("Expected an Institute sitemap response");
      }

      const xml = yield* Effect.tryPromise(() => response.text());

      const links = [
        ...new DOMParser()
          .parseFromString(xml, "application/xml")
          .querySelectorAll("loc"),
      ].map((loc) => loc.textContent);

      expect(links).toEqual([
        "https://ratstack.sh/institute",
        "https://ratstack.sh/institute/chapters/one-contract",
      ]);
    })
);

it.effect(
  "a deep link renders and hydrates the selected section without losing its fallback",
  () =>
    Effect.gen(function* chapterHydration() {
      const chapter = yield* documentFor(
        "/institute/chapters/one-contract?section=define-boundary"
      );

      const canonical = "https://ratstack.sh/institute/chapters/one-contract";
      expect(
        chapter.querySelector('link[rel="canonical"]')?.getAttribute("href")
      ).toBe(canonical);
      expect(
        chapter
          .querySelector('meta[property="og:url"]')
          ?.getAttribute("content")
      ).toBe(canonical);
      expect(chapter.querySelector("#institute-player p")?.textContent).toBe(
        transcript
      );
      expect(chapter.querySelector("#institute-player mark")).toBeNull();
      expect(
        chapter.querySelector('a[aria-current="page"]')?.getAttribute("href")
      ).toBe("/institute/chapters/one-contract?section=define-boundary");
      expect(
        chapter.querySelector(
          'a[href="https://www.effect.institute/chapters/intro?section=effect-shows-errors"]'
        )?.textContent
      ).toBe("Effect shows errors");

      const handoff = yield* Schema.decodeEffect(
        Schema.fromJsonString(InstituteHandoff)
      )(chapter.querySelector(`#${instituteHandoffId}`)?.textContent ?? "");

      const hydrated = yield* ssr(InstitutePage, handoff.props).pipe(
        Effect.provide(TestHost.layer())
      );

      expect(hydrated.adopted).toEqual(["/InstitutePage"]);
      expect(
        hydrated.container.querySelector<HTMLDivElement>("#institute-player")
          ?.dataset.audioUrl
      ).toBe("/institute/content/one-contract/define-boundary.01234567.webm");
    })
);

it.effect(
  "unlisted pages carry noindex without changing canonical URLs or cards",
  () =>
    Effect.gen(function* unlistedInstitute() {
      for (const path of [
        "/institute",
        "/institute/credits",
        "/institute/chapters/one-contract?section=define-boundary",
      ]) {
        const unlisted = yield* documentFor(path, false);
        const discoverable = yield* documentFor(path);
        const robots = 'meta[name="robots"]';
        expect(unlisted.querySelector(robots)?.getAttribute("content")).toBe(
          "noindex, nofollow"
        );
        expect(discoverable.querySelector(robots)).toBeNull();

        for (const name of [
          'link[rel="canonical"]',
          'meta[property="og:url"]',
          'meta[name="twitter:image"]',
        ]) {
          expect(unlisted.querySelector(name)?.outerHTML).toBe(
            discoverable.querySelector(name)?.outerHTML
          );
        }
      }

      expect(yield* read("/institute/sitemap.xml", false)).toBeNull();
      const credits = yield* documentFor("/institute/credits");
      expect(credits.querySelector("main")?.textContent).toContain(
        "Narration voice: Tom - Conversations & Books, from the ElevenLabs Voice Library"
      );
      expect(credits.querySelector("pre")?.textContent).toContain(
        "Copyright (c) 2026 Kit Langton"
      );
    })
);

it.effect(
  "absent and unknown section IDs both use the first section, even without narration",
  () =>
    Effect.gen(function* firstSection() {
      for (const search of ["", "?section=unknown&fresh=1"]) {
        const document = yield* documentFor(
          `/institute/chapters/one-contract${search}`
        );

        const player =
          document.querySelector<HTMLDivElement>("#institute-player");

        expect(player?.dataset.section).toBe("bind-behavior");
        expect(player?.dataset.audioUrl).toBeUndefined();
        expect(player?.textContent).toContain(
          "This section has no narration yet."
        );
      }
    })
);
