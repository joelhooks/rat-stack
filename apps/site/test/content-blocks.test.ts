import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  buildBlockIndex,
  paragraphAnchors,
} from "../scripts/content-blocks.ts";
import type { ContentBlock } from "../scripts/content-blocks.ts";
import { buildError } from "../scripts/content-lib.ts";
import { markdownHast, renderMarkdownHtml } from "../scripts/markdown-html.ts";

const indexFor = (rawText: string) =>
  buildBlockIndex([
    { rawText, routePath: "/lore/source", title: "Source page" },
  ]);

it.effect.prop(
  "unrelated edits preserve paragraph and list-item IDs",
  {
    edit: Arbitrary.schema(Schema.String),
  },
  ({ edit }) =>
    Effect.gen(function* stableBlockIds() {
      const before = yield* indexFor(
        "Original paragraph.\n\nUnchanged paragraph.\n\n- Unchanged item."
      );

      const after = yield* indexFor(
        `Changed ${JSON.stringify(edit)}.\n\nUnchanged paragraph.\n\n- Unchanged item.`
      );

      const stableBlocks = before
        .get("/lore/source")
        ?.blocks.filter((block) => block.text.includes("Unchanged"));

      expect(stableBlocks?.length).toBe(2);

      for (const block of stableBlocks ?? []) {
        expect(
          after
            .get("/lore/source")
            ?.blocks.find((candidate) => candidate.text === block.text)?.id
        ).toBe(block.id);
      }
    })
);

it.effect("explicit IDs win and collisions remain unique", () =>
  Effect.gen(function* explicitBlockIds() {
    const initial = yield* indexFor("Repeated.\n\nRepeated.");
    const generatedId = initial.get("/lore/source")?.blocks[0]?.id;

    const index = yield* indexFor(
      `Repeated.\n\nExplicit. {#${generatedId}}\n\nRepeated.`
    );

    const blocks = index.get("/lore/source")?.blocks ?? [];

    expect(blocks.find((block) => block.text === "Explicit.")?.id).toBe(
      generatedId
    );
    expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length);
  })
);

it.effect(
  "syntax-highlighter markup cannot change a list item's source ID",
  () =>
    Effect.gen(function* styledBlockIds() {
      const source = "- Code claim.\n\n  ```text\n  value\n  ```";
      const index = yield* indexFor(source);

      const expected = index
        .get("/lore/source")
        ?.blocks.map((block) => block.id);

      for (const theme of ["one", "two"]) {
        const blocks: ContentBlock[] = [];

        yield* Effect.try({
          catch: (cause) => buildError("test compile", "fixture.svx", cause),
          try: () =>
            markdownHast(source, {
              highlight: (code) =>
                `<pre class="${theme}"><code>${code}</code></pre>`,
              rehypePlugins: [paragraphAnchors(source, blocks)],
              sourcePath: "fixture.svx",
            }),
        });

        expect(blocks.map((block) => block.id)).toEqual(expected);
      }
    })
);

const renderMarkdown = (source: string) =>
  Effect.try({
    catch: (cause) => buildError("test compile", "fixture.svx", cause),
    try: () =>
      renderMarkdownHtml(source, {
        rehypePlugins: [paragraphAnchors(source)],
        sourcePath: "fixture.svx",
      }),
  });

it.effect("paragraph links resolve in tight, loose and nested lists", () =>
  Effect.gen(function* renderedAnchors() {
    const html = yield* renderMarkdown(
      "Claim. {#claim}\n\n- Tight item. {#item}\n- Next item.\n  - Nested item.\n\n- Loose item.\n\n  Second paragraph."
    );

    const ids = [...html.matchAll(/ id="(?<id>[^"]+)"/gu)].map(
      (match) => match.groups?.id
    );

    expect(ids).toContain("claim");
    expect(ids).toContain("item");
    expect(new Set(ids).size).toBe(ids.length);
    expect(html).not.toContain("{#");

    for (const match of html.matchAll(
      /class="paragraph-link" href="#(?<id>[^"]+)"/gu
    )) {
      expect(ids).toContain(match.groups?.id);
    }

    expect(
      [...html.matchAll(/aria-label="Link to this paragraph"/gu)].length
    ).toBe(ids.length);
  })
);
