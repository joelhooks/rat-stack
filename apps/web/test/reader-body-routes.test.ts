import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { renderToString } from "foldkit/experimental/server";

import {
  compileReaderBody,
  readerWorkshopCount,
} from "../../mischief/scripts/reader-body-document.ts";
import {
  readerBodyFlags,
  readerCopyPrompts,
} from "../../mischief/scripts/reader-body-flags.ts";
import { prepareReaderSiteInputs } from "../../mischief/scripts/reader-site-inputs.ts";
import { init } from "../src/client/reader/init.js";
import { ReaderFlags } from "../src/client/reader/model.js";
import { view } from "../src/features/reader.js";
import { readerBodyRoutePaths } from "../src/reader-routes.js";
import { normalizedNodes } from "./reader-node-normalize.js";

it.effect(
  "ReaderSiteParity: glossary, log, resources, tokenmaxx and public specs keep their complete human body, breadcrumb and metadata after Foldkit rendering",
  () =>
    Effect.gen(function* bodyRouteParity() {
      const inputs = yield* prepareReaderSiteInputs;
      const flags = yield* readerBodyFlags("https://ratstack.sh");

      expect(flags.map((page) => page.page.path).toSorted()).toEqual(
        readerBodyRoutePaths.toSorted()
      );

      yield* Effect.forEach((page: (typeof flags)[number]) =>
        Effect.gen(function* pageParity() {
          const original = inputs.pages.find(
            (candidate) => candidate.path === page.page.path
          );

          expect(original).toBeDefined();

          const before = yield* compileReaderBody(
            original?.html.replaceAll("__RATSTACK_ORIGIN__", page.origin) ?? "",
            page.page.sourcePath,
            readerCopyPrompts(page.origin)
          );

          const rendered = yield* renderToString(
            { Flags: ReaderFlags, init, view },
            { flags: page, isHydratable: false }
          );

          const after = yield* compileReaderBody(
            rendered.html,
            page.page.sourcePath,
            readerCopyPrompts(page.origin)
          );

          expect(readerWorkshopCount(rendered.html), page.page.path).toBe(
            readerWorkshopCount(original?.html ?? "")
          );
          expect(after.heading, page.page.path).toBe(before.heading);
          expect(after.breadcrumb, page.page.path).toEqual(before.breadcrumb);
          expect(normalizedNodes(after.nodes), page.page.path).toEqual(
            normalizedNodes(before.nodes)
          );
          expect(page.page.generation).toBe(inputs.generation);
          expect(page.page.metadata).toEqual(original?.metadata);
        })
      )(flags);
    }).pipe(Effect.provide(NodeServices.layer))
);
