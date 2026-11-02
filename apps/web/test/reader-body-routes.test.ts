import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { renderToString } from "foldkit/experimental/server";

import {
  compileReaderBody,
  readerNewsTitle,
} from "../../site/scripts/reader-body-document.ts";
import {
  readerBodyFlags,
  readerCopyPrompts,
} from "../../site/scripts/reader-body-flags.ts";
import { prepareReaderSiteInputs } from "../../site/scripts/reader-site-inputs.ts";
import { init } from "../src/client/reader/init.js";
import { ReaderFlags } from "../src/client/reader/model.js";
import { view } from "../src/features/reader.js";
import {
  isAllStarsRoutePath,
  readerBodyRoutePaths,
} from "../src/reader-routes.js";
import { normalizedNodes } from "./reader-node-normalize.js";

const make = Effect.gen(function* readerParityFixture() {
  const inputs = yield* prepareReaderSiteInputs;
  const flags = yield* readerBodyFlags("https://ratstack.sh");

  return { flags, inputs };
});

class ReaderParityFixture extends Context.Service<
  ReaderParityFixture,
  Effect.Success<typeof make>
>()("@rat-stack/web/test/ReaderParityFixture") {
  static readonly layer = Layer.effect(ReaderParityFixture, make).pipe(
    Layer.provide(NodeServices.layer)
  );
}

const parityTitle = (path: string) =>
  `ReaderSiteParity ${path}: keeps its complete human body, breadcrumb and metadata after Foldkit rendering`;

it.layer(ReaderParityFixture.layer)((test) => {
  test.effect("ReaderSiteParity: every body route has a rendered page", () =>
    Effect.gen(function* bodyRouteCoverage() {
      const { flags, inputs } = yield* ReaderParityFixture;

      const allStars = inputs.pages
        .map((page) => page.path)
        .filter(isAllStarsRoutePath);

      expect(allStars).toContain("/all-stars");
      expect(flags.map((page) => page.page.path).toSorted()).toEqual(
        [...readerBodyRoutePaths, ...allStars].toSorted()
      );
    })
  );

  for (const path of readerBodyRoutePaths) {
    test.effect(parityTitle(path), () =>
      Effect.gen(function* pageParity() {
        const { flags, inputs } = yield* ReaderParityFixture;
        const page = flags.find((candidate) => candidate.page.path === path);

        const original = inputs.pages.find(
          (candidate) => candidate.path === path
        );

        expect(page).toBeDefined();
        expect(original).toBeDefined();

        if (page === undefined) {
          return;
        }

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

        expect(readerNewsTitle(rendered.html), path).toBe(
          readerNewsTitle(original?.html ?? "")
        );
        expect(rendered.html).toMatch(/<a [^>]*href="\/news"[^>]*>news<\/a>/u);
        expect(after.heading, path).toBe(before.heading);
        expect(after.breadcrumb, path).toEqual(before.breadcrumb);
        expect(normalizedNodes(after.nodes), path).toEqual(
          normalizedNodes(before.nodes)
        );
        expect(page.page.generation).toBe(inputs.generation);
        expect(page.page.metadata).toEqual(original?.metadata);
      }).pipe(Effect.provide(NodeServices.layer))
    );
  }
});
