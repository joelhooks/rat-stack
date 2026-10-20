import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { renderToString } from "foldkit/experimental/server";

import {
  compileReaderBody,
  readerWorkshopCount,
} from "../../site/scripts/reader-body-document.ts";
import { readerLoreFlags } from "../../site/scripts/reader-lore-flags.ts";
import { prepareReaderSiteInputs } from "../../site/scripts/reader-site-inputs.ts";
import { init } from "../src/client/reader/init.js";
import { ReaderFlags } from "../src/client/reader/model.js";
import { view } from "../src/features/reader.js";
import { normalizedNodes } from "./reader-node-normalize.js";

const loreShardCount = 8;

const make = Effect.gen(function* readerLoreFixture() {
  const inputs = yield* prepareReaderSiteInputs;
  const flags = yield* readerLoreFlags("https://ratstack.sh");

  const pages = inputs.pages.filter(
    (page) => page.path === "/lore" || page.path.startsWith("/lore/")
  );

  return { flags, inputs, pages };
});

class ReaderLoreFixture extends Context.Service<
  ReaderLoreFixture,
  Effect.Success<typeof make>
>()("@rat-stack/web/test/ReaderLoreFixture") {
  static readonly layer = Layer.effect(ReaderLoreFixture, make).pipe(
    Layer.provide(NodeServices.layer)
  );
}

it.layer(ReaderLoreFixture.layer)((test) => {
  test.effect("ReaderSiteParity: every lore route has a rendered page", () =>
    Effect.gen(function* loreCoverage() {
      const { flags, pages } = yield* ReaderLoreFixture;

      expect(flags.map((page) => page.page.path)).toEqual(
        pages.map((page) => page.path)
      );
    })
  );

  for (let shard = 0; shard < loreShardCount; shard += 1) {
    test.effect(
      `ReaderSiteParity lore shard ${shard + 1}/${loreShardCount}: keeps the complete human body and breadcrumb after Foldkit rendering`,
      () =>
        Effect.gen(function* loreShardParity() {
          const { flags, inputs, pages } = yield* ReaderLoreFixture;

          yield* Effect.forEach(
            flags.filter((_, index) => index % loreShardCount === shard),
            (page) =>
              Effect.gen(function* pageParity() {
                const original = pages.find(
                  (candidate) => candidate.path === page.page.path
                );

                expect(original).toBeDefined();

                const before = yield* compileReaderBody(
                  original?.html.replaceAll(
                    "__RATSTACK_ORIGIN__",
                    page.origin
                  ) ?? "",
                  page.page.sourcePath
                );

                const rendered = yield* renderToString(
                  { Flags: ReaderFlags, init, view },
                  { flags: page, isHydratable: false }
                );

                const after = yield* compileReaderBody(
                  rendered.html,
                  page.page.sourcePath
                );

                expect(readerWorkshopCount(rendered.html), page.page.path).toBe(
                  readerWorkshopCount(original?.html ?? "")
                );
                expect(after.heading, page.page.path).toBe(before.heading);
                expect(after.breadcrumb, page.page.path).toEqual(
                  before.breadcrumb
                );
                expect(normalizedNodes(after.nodes), page.page.path).toEqual(
                  normalizedNodes(before.nodes)
                );
                expect(page.page.generation).toBe(inputs.generation);
                expect(page.page.metadata).toEqual(original?.metadata);
              })
          );
        }).pipe(Effect.provide(NodeServices.layer))
    );
  }
});
