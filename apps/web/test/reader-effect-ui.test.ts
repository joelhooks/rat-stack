import { NodeServices } from "@effect/platform-node";
import { HtmlServer } from "@effect/ui/html";
import { HtmlLocator, HtmlScene, ssr } from "@effect/ui/html/testing";
import { Story, TestHost } from "@effect/ui/testing";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { compileLegacyReaderPage } from "../scripts/reader-effect-ui-legacy.js";
import {
  CopyReaderText,
  DetectClipboard,
  WaitBeforeCopyReset,
} from "../src/client/reader-effect-ui/command.js";
import { ReaderPage } from "../src/client/reader-effect-ui/component.js";
import { ReaderMessage } from "../src/client/reader-effect-ui/model.js";
import { init } from "../src/client/reader/init.js";
import { ReaderFlags } from "../src/client/reader/model.js";
import { view } from "../src/features/reader.js";
import {
  renderDocument,
  withReaderHead,
} from "../src/server/reader-document.js";
import {
  readerProps,
  readerSupportsEffectUi,
} from "../src/server/reader-effect-ui-props.js";
import { promptFixture, readerFlagsFixture } from "./reader-fixture.js";

const { id, label, text } = promptFixture;

const detected = ReaderMessage.CompletedDetectClipboard({ available: true });

const reset = ReaderMessage.CompletedWaitBeforeCopyReset({ id });

const failed = ReaderMessage.FailedCopyReaderText({ id });

const copied = ReaderMessage.SucceededCopyReaderText({ id });

const clicked = ReaderMessage.ClickedCopy({ id });

it.effect(
  "the copy story detects availability, ignores duplicates, retries a failure and resets a success",
  () =>
    Effect.gen(function* clipboardStory() {
      const props = readerProps(readerFlagsFixture);
      const story = yield* Story.make(ReaderPage, props);
      story.expectExact(DetectClipboard);
      expect(story.model.clipboard).toBe("unknown");
      story.keepPending(DetectClipboard).send(clicked);
      expect(story.model.copyStatuses[id]).toBeUndefined();
      story.resolve(
        DetectClipboard,
        ReaderMessage.CompletedDetectClipboard({ available: false })
      );
      expect(story.model.clipboard).toBe("unavailable");
      story.send(clicked);
      expect(story.model.copyStatuses[id]).toBeUndefined();
      story.send(detected);
      story.send(ReaderMessage.ClickedCopy({ id: "missing" }));
      story.send(clicked).expectExact(CopyReaderText.make({ id, text }));
      expect(story.model.copyStatuses[id]).toBe("copying");
      story.keepPending(CopyReaderText).send(clicked);
      story.resolve(CopyReaderText, failed);
      expect(story.model.copyStatuses[id]).toBe("failed");
      story.send(clicked).expectExact(CopyReaderText.make({ id, text }));
      story
        .resolve(CopyReaderText, copied)
        .expectExact(WaitBeforeCopyReset.make({ id }));
      expect(story.model.copyStatuses[id]).toBe("copied");
      story.keepPending(WaitBeforeCopyReset).send(clicked);
      story.resolve(WaitBeforeCopyReset, reset);
      expect(story.model.copyStatuses[id]).toBeUndefined();
    })
);

it.effect("the copy scene uses the button and announces both outcomes", () =>
  Effect.gen(function* clipboardScene() {
    const compiled = yield* compileLegacyReaderPage(readerFlagsFixture);
    const props = readerProps(compiled);
    const scene = yield* HtmlScene.make(ReaderPage, props);
    const button = HtmlLocator.role("button", { name: label });
    const status = HtmlLocator.role("status");

    scene.expect(button).toBeAbsent();
    scene.expectExact(DetectClipboard).resolve(DetectClipboard, detected);
    scene
      .click(button)
      .expectExact(CopyReaderText.make({ id, text }))
      .resolve(CopyReaderText, failed);
    scene
      .expect(status)
      .toHaveText("Copy failed. Select the text and copy it.");
    scene
      .click(button)
      .expectExact(CopyReaderText.make({ id, text }))
      .resolve(CopyReaderText, copied);
    scene.expect(button).toHaveAttribute("data-copied", "true");
    scene.expect(status).toHaveText("Copied ✓");
    scene.expectExact(WaitBeforeCopyReset).resolve(WaitBeforeCopyReset, reset);
    scene.expect(button).toHaveAttribute("data-copied", "false");
  })
);

const parse = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

const contentHead = (page: Document) =>
  [
    ...page.head.querySelectorAll(
      'title, meta, link[rel="canonical"], script[type="application/ld+json"]'
    ),
  ].map((element) => element.outerHTML);

const textOf = (root: ParentNode) =>
  [...root.querySelectorAll("header, main, footer")].map((node) =>
    (node.textContent ?? "").replaceAll(/\s+/gu, " ").trim()
  );

const pageStructure = (root: ParentNode, excludeFoldkitMarkers = false) =>
  [
    ...root.querySelectorAll(
      "header, header *, main, main *, footer, footer *"
    ),
  ].map((node) => [
    node.localName,
    ...[...node.attributes]
      .flatMap(({ name, value }) =>
        excludeFoldkitMarkers &&
        (name === "data-foldkit-identity" || name === "data-foldkit-key")
          ? []
          : [[name, value]]
      )
      .toSorted(([left = ""], [right = ""]) => left.localeCompare(right)),
  ]);

const readerPages = Effect.gen(function* readerPages() {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;

  const json = yield* fs.readFileString(
    paths.resolve(import.meta.dirname, "../dist/reader-pages.json")
  );

  return yield* Schema.decodeEffect(
    Schema.fromJsonString(Schema.Array(ReaderFlags))
  )(json);
});

const flagsAt = (path: string) =>
  readerPages.pipe(
    Effect.flatMap((pages) =>
      Effect.fromNullishOr(pages.find((page) => page.page.path === path))
    )
  );

const foldkit = (flags: typeof ReaderFlags.Type) =>
  renderToString(
    { Flags: ReaderFlags, init, view },
    { flags, isHydratable: false }
  );

it.live.prop(
  "every packaged lore and systems page preserves Foldkit's content and metadata",
  { start: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 })) },
  ({ start }) =>
    Effect.gen(function* packagedParity() {
      const fs = yield* FileSystem.FileSystem;
      const paths = yield* Path.Path;
      const client = paths.resolve(import.meta.dirname, "../dist/client");
      const pages = yield* readerPages;

      const lore = pages.filter(
        ({ page }) => page.path === "/lore" || page.path.startsWith("/lore/")
      );

      expect(lore.length).toBeGreaterThan(1);
      expect(
        lore.flatMap((flags) =>
          readerSupportsEffectUi(flags) ? [] : [flags.page.path]
        )
      ).toEqual([]);

      const systems = pages.filter(
        ({ page }) =>
          page.path === "/systems" || page.path.startsWith("/systems/")
      );

      expect(systems).toHaveLength(22);
      expect(
        systems.flatMap((flags) =>
          readerSupportsEffectUi(flags) ? [] : [flags.page.path]
        )
      ).toEqual(["/systems/motion"]);

      const sectionPages = [...lore, ...systems];
      const offset = start % sectionPages.length;

      const visit = [
        ...sectionPages.slice(offset),
        ...sectionPages.slice(0, offset),
      ];

      yield* Effect.forEach(
        visit,
        (flags) =>
          Effect.gen(function* compareReaderPage() {
            const { path } = flags.page;
            const isMotion = path === "/systems/motion";

            const html = yield* fs.readFileString(
              paths.join(client, path, "index.html")
            );

            const actual = parse(html);
            const legacy = yield* foldkit(flags);

            const expected = parse(
              renderDocument(withReaderHead(legacy, flags), {
                entryScript: "/assets/app.js",
                modulePreloads: [],
                stylesheets: [],
              })
            );

            if (isMotion) {
              expect(
                actual.querySelector("#reader-effect-ui"),
                path
              ).toBeNull();
              expect(
                actual.querySelector("[data-foldkit-app]"),
                path
              ).not.toBeNull();
              expect(
                actual.querySelector(
                  'script[type="module"][src^="/assets/app-"]'
                ),
                path
              ).not.toBeNull();
            } else {
              expect(
                actual.querySelector("#reader-effect-ui"),
                path
              ).not.toBeNull();
              expect(
                actual.querySelector("[data-foldkit-app]"),
                path
              ).toBeNull();
            }

            expect(actual.documentElement.lang, path).toBe(
              expected.documentElement.lang
            );
            expect(contentHead(actual), path).toEqual(contentHead(expected));
            expect(textOf(actual), path).toEqual(textOf(expected));
            const actualStructure = pageStructure(actual, isMotion);
            const expectedStructure = pageStructure(expected);

            const mismatch = actualStructure.findIndex(
              (node, index) =>
                JSON.stringify(node) !==
                JSON.stringify(expectedStructure[index])
            );

            if (mismatch !== -1) {
              expect(
                actualStructure[mismatch],
                `${path}: element ${mismatch}`
              ).toEqual(expectedStructure[mismatch]);
            }

            expect(actualStructure.length, path).toBe(expectedStructure.length);
          }),
        { discard: true }
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 1, maxShrinks: 0 }, timeout: 30_000 }
);

it.layer(TestHost.layer())((test) => {
  test.effect(
    "SSR adopts the real lore DOM with the same text, headings and links",
    () =>
      Effect.gen(function* adoptLore() {
        const page = yield* flagsAt("/lore/services-capture-dependencies");
        const props = readerProps(page);
        const legacy = yield* foldkit(page);
        const expected = parse(legacy.html);
        const rendered = yield* ssr(ReaderPage, props);
        expect(rendered.adopted).toEqual(["/ReaderPage"]);
        expect(textOf(rendered.container)).toEqual(textOf(expected));
        expect(pageStructure(rendered.container)).toEqual(
          pageStructure(expected)
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );
});

it.effect(
  "legacy block pages project their prompts, paragraphs and highlighted code into the same reader",
  () =>
    Effect.gen(function* legacyDocument() {
      const page = yield* flagsAt("/");
      const compiled = yield* compileLegacyReaderPage(page);
      const props = readerProps(compiled);
      const legacy = yield* foldkit(page);
      const current = yield* HtmlServer.renderToHtml(ReaderPage, props);
      const expected = parse(legacy.html);
      const actual = parse(current.html);
      expect(actual.querySelectorAll("pre code").length).toBeGreaterThan(0);
      expect(actual.querySelectorAll("button.copy").length).toBeGreaterThan(0);
      expect(textOf(actual)).toEqual(textOf(expected));
      expect(
        [...actual.querySelectorAll("main a[href], main pre")].map(
          (node) => node.textContent
        )
      ).toEqual(
        [...expected.querySelectorAll("main a[href], main pre")].map(
          (node) => node.textContent
        )
      );
    }).pipe(Effect.provide(NodeServices.layer))
);
