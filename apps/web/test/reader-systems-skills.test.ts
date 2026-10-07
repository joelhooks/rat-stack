import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { renderToString } from "foldkit/experimental/server";

import {
  prepareReaderSiteInputs,
  readerAssetInputs,
} from "../../mischief/scripts/reader-site-inputs.ts";
import { readerSystemsSkillsFlags } from "../../mischief/scripts/reader-systems-skills-flags.ts";
import { isSystemsSkillsRoute } from "../../mischief/scripts/reader-systems-skills-routes.ts";
import { withReaderWebsite } from "../../mischief/src/reader-website.js";
import {
  footerSemantics,
  mainSemantics,
} from "../../mischief/test/reader-semantics.ts";
import { ReaderFlags, readerInit } from "../src/client/reader-model.js";
import { readerView } from "../src/features/reader.js";

it.effect(
  "ReaderSiteParity preserves every systems and skills main, table and deep link",
  () =>
    Effect.gen(function* systemsSkillsParity() {
      const inputs = yield* prepareReaderSiteInputs;
      const flags = yield* readerSystemsSkillsFlags("https://ratstack.sh");

      const expected = inputs.pages.filter((page) =>
        isSystemsSkillsRoute(page.path)
      );

      expect(flags.map((page) => page.page.path).toSorted()).toEqual(
        expected.map((page) => page.path).toSorted()
      );
      expect(flags.length).toBeGreaterThan(2);

      for (const input of flags) {
        const page = yield* Schema.decodeUnknownEffect(ReaderFlags)(input);

        const rendered = yield* renderToString(
          { Flags: ReaderFlags, init: readerInit, view: readerView },
          { flags: page, isHydratable: false }
        );

        const old = expected.find(
          (candidate) => candidate.path === page.page.path
        );

        expect(old, page.page.path).toBeDefined();
        expect(mainSemantics(rendered.html), page.page.path).toEqual(
          mainSemantics(
            old?.html.replaceAll("__RATSTACK_ORIGIN__", page.origin) ?? ""
          )
        );
        expect(footerSemantics(rendered.html), page.page.path).toEqual(
          footerSemantics(old?.html ?? "")
        );
        expect(page.page.generation).toBe(inputs.generation);
        expect(page.page.metadata.canonicalPath).toBe(page.page.path);

        if (page.page.path.startsWith("/skills/")) {
          expect(page.page.sourcePath).toMatch(/^skills\/[^/]+\/SKILL\.md$/u);
          expect(page.breadcrumb?.href).toBe("/skills");
        }

        if (page.page.path.startsWith("/systems/")) {
          expect(page.page.sourcePath).toMatch(/^\.brain\/areas\/[^/]+\.svx$/u);
          expect(page.breadcrumb?.href).toBe("/systems");

          const headings = mainSemantics(rendered.html).headings.map(
            (heading) => heading.text
          );

          expect(headings).toEqual(
            expect.arrayContaining([
              "What it does",
              "The standard",
              "How to check",
            ])
          );
        }
      }
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect("Reader routing preserves same-generation agent Markdown bytes", () =>
  Effect.gen(function* sameGenerationMarkdown() {
    const fs = yield* FileSystem.FileSystem;
    const { directory, manifest } = yield* readerAssetInputs;
    const flags = yield* readerSystemsSkillsFlags("https://ratstack.sh");

    const pages = manifest.pages.filter((page) =>
      isSystemsSkillsRoute(page.route)
    );

    expect(flags.map((page) => page.page.generation)).toEqual(
      pages.map(() => manifest.generation)
    );

    for (const page of pages) {
      const asset = yield* fs.readFileString(`${directory}${page.markdown}`);

      const markdown = asset.replaceAll(
        "__RATSTACK_ORIGIN__",
        "https://ratstack.sh"
      );

      const fallback = Effect.succeed(
        HttpServerResponse.text(markdown, { contentType: "text/markdown" })
      );

      const route = withReaderWebsite(
        Effect.die("Agent Markdown must not touch the HTML reader binding")
      )(fallback);

      for (const accept of ["*/*", "text/markdown"]) {
        const request = HttpServerRequest.fromWeb(
          new Request(`https://ratstack.sh${page.route}`, {
            headers: { accept },
          })
        );

        const response = yield* route.pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, request)
        );

        const webResponse = HttpServerResponse.toWeb(response);
        const body = yield* Effect.promise(webResponse.text.bind(webResponse));

        expect(response.status, page.route).toBe(200);
        expect(response.headers["content-type"], page.route).toContain(
          "text/markdown"
        );
        expect(body, page.route).toBe(markdown);
      }
    }
  }).pipe(Effect.provide(NodeServices.layer))
);
