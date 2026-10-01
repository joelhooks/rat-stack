import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { compile } from "mdsvex";

import {
  createComponentRegistry,
  renderSvxMarkdown,
} from "../scripts/component-registry.ts";
import {
  buildBlockIndex,
  paragraphAnchors,
} from "../scripts/content-blocks.ts";
import { buildError } from "../scripts/content-error.ts";
import {
  createRefComponent,
  extractBlockReferences,
} from "../scripts/content-references.ts";
import { parseContentMarkdown } from "../scripts/svx-ast.ts";

const source =
  "Verbatim **claim**. {#claim}\n\n- First item.\n- List claim. {#item}\n  - Nested claim.\n\nA [source link][proof]. {#linked}\n\n[proof]: https://example.com/proof";

const fixture = Effect.fn("fixture")(function* fixture() {
  const index = yield* buildBlockIndex([
    { rawText: source, routePath: "/lore/source", title: "Source page" },
  ]);

  return createComponentRegistry({ Ref: createRefComponent(index) });
});

const compilePage = (markdown: string) =>
  Effect.tryPromise({
    catch: (cause) => buildError("test compile", "fixture.svx", cause),
    // @effect-diagnostics-next-line asyncFunction:off -- mdsvex owns this rendering-test Promise boundary.
    try: async () =>
      await compile(markdown, { rehypePlugins: [paragraphAnchors(markdown)] }),
  });

it.effect(
  "missing pages and planted missing block IDs fail the build renderer",
  () =>
    Effect.gen(function* missingReferences() {
      const registry = yield* fixture();

      expect(() =>
        renderSvxMarkdown(
          '<Ref page="/lore/missing" id="claim"/>',
          "human",
          { sourcePath: "consumer.svx" },
          registry
        )
      ).toThrow("block reference");
      expect(() =>
        renderSvxMarkdown(
          '<Ref page="/lore/source" id="planted-missing"/>',
          "agent",
          { sourcePath: "consumer.svx" },
          registry
        )
      ).toThrow("block reference");
    })
);

it.effect(
  "human transclusion attribution resolves to a source block anchor",
  () =>
    Effect.gen(function* renderedTransclusion() {
      const registry = yield* fixture();

      const markdown = renderSvxMarkdown(
        '<Ref page="/lore/source" id="claim"/>',
        "human",
        { sourcePath: "consumer.svx" },
        registry
      );

      const embedded = yield* compilePage(markdown);
      const sourceHtml = yield* compilePage(source);

      const index = yield* buildBlockIndex([
        { rawText: source, routePath: "/lore/source", title: "Source page" },
      ]);

      expect(embedded?.code).toContain('href="/lore/source#claim"');
      expect(sourceHtml?.code).toContain('id="claim"');
      expect(embedded?.code).toContain("from Source page");
      expect(embedded?.code).toContain("Verbatim <strong>claim</strong>.");
      expect(
        index.get("/lore/source")?.blocks.some((block) => block.id === "claim")
      ).toBe(true);
    })
);

it.effect("agent Markdown embeds the block text and source link as mdast", () =>
  Effect.gen(function* agentTransclusion() {
    const registry = yield* fixture();

    const markdown = renderSvxMarkdown(
      '<Ref id="claim" page="/lore/source" />',
      "agent",
      {},
      registry
    );

    const root = parseContentMarkdown(markdown);

    expect(root.children).toMatchObject([
      {
        children: [
          { type: "text", value: "Verbatim " },
          { children: [{ type: "text", value: "claim" }], type: "strong" },
          { type: "text", value: "." },
        ],
        type: "paragraph",
      },
      {
        children: [
          {
            children: [{ type: "text", value: "from Source page" }],
            type: "link",
            url: "/lore/source#claim",
          },
        ],
        type: "paragraph",
      },
    ]);
    expect(markdown).not.toContain("{#");
  })
);

it.effect(
  "list refs retain nesting and page-local reference links retain their destinations",
  () =>
    Effect.gen(function* structuredTransclusion() {
      const registry = yield* fixture();

      const listMarkdown = renderSvxMarkdown(
        '<Ref page="/lore/source" id="item"/>',
        "agent",
        {},
        registry
      );

      const linkMarkdown = renderSvxMarkdown(
        '<Ref page="/lore/source" id="linked"/>',
        "agent",
        {},
        registry
      );

      expect(parseContentMarkdown(listMarkdown).children[0]).toMatchObject({
        children: [
          {
            children: [{ type: "paragraph" }, { type: "list" }],
            type: "listItem",
          },
        ],
        type: "list",
      });
      expect(linkMarkdown).toContain("https://example.com/proof");
    })
);

it.effect("only actual source refs contribute backlink data", () =>
  Effect.sync(() => {
    expect(
      extractBlockReferences(
        '`<Ref page="/lore/code" id="code"/>`\n\n```svx\n<Ref page="/lore/code" id="code"/>\n```\n\n<Ref id="claim" page="/lore/source"/>'
      )
    ).toEqual([{ id: "claim", page: "/lore/source" }]);
  })
);
