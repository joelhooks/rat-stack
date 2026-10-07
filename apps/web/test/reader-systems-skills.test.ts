import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { prepareReaderSiteInputs } from "../../mischief/scripts/reader-site-inputs.ts";
import { readerSystemsSkillsFlags } from "../../mischief/scripts/reader-systems-skills-flags.ts";
import { isSystemsSkillsRoute } from "../../mischief/scripts/reader-systems-skills-routes.ts";
import { mainSemantics } from "../../mischief/test/reader-semantics.ts";
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
