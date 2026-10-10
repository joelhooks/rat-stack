import type { Block, Inline, MarkdownDocument } from "@foldkit/markdown";
import { codeIdentity } from "@rat-stack/code-snippets";
import { Match, Option } from "effect";
import type {
  BlockContent,
  DefinitionContent,
  PhrasingContent,
  Root,
  RootContent,
} from "mdast";

import { componentContext, renderComponent } from "./component-registry.ts";
import type {
  ComponentRegistry,
  ComponentRenderContext,
  ComponentTarget,
} from "./component-registry.ts";
import { contentRoot, stringifyContentMarkdown } from "./svx-ast.ts";

export { codeIdentity } from "@rat-stack/code-snippets";

export interface ListLayout {
  readonly items: readonly (boolean | null | undefined)[];
  readonly spread: boolean | null | undefined;
}

const inlineNode = (node: Inline): PhrasingContent =>
  Match.value(node).pipe(
    Match.withReturnType<PhrasingContent>(),
    Match.tagsExhaustive({
      Emphasis: ({ content }) => ({
        children: content.map(inlineNode),
        type: "emphasis",
      }),
      HardBreak: () => ({ type: "break" }),
      Image: ({ alt, maybeTitle, url }) => ({
        alt,
        title: Option.getOrUndefined(maybeTitle),
        type: "image",
        url,
      }),
      InlineCode: ({ value }) => ({ type: "inlineCode", value }),
      Link: ({ content, maybeTitle, url }) => ({
        children: content.map(inlineNode),
        title: Option.getOrUndefined(maybeTitle),
        type: "link",
        url,
      }),
      Strikethrough: ({ content }) => ({
        children: content.map(inlineNode),
        type: "delete",
      }),
      Strong: ({ content }) => ({
        children: content.map(inlineNode),
        type: "strong",
      }),
      Text: ({ value }) => ({ type: "text", value }),
    })
  );

const requireBlock = (node: RootContent): BlockContent | DefinitionContent =>
  Match.value(node).pipe(
    Match.withReturnType<BlockContent | DefinitionContent>(),
    Match.when(
      {
        type: Match.is(
          "heading",
          "paragraph",
          "code",
          "blockquote",
          "thematicBreak",
          "list",
          "table",
          "html",
          "definition",
          "footnoteDefinition"
        ),
      },
      (value) => value
    ),
    Match.orElse((value) => {
      throw new Error(`Island emitted non-block ${value.type}`);
    })
  );

const alignmentValue = Match.type<"Left" | "Center" | "Right" | "None">().pipe(
  Match.when("Left", () => "left" as const),
  Match.when("Center", () => "center" as const),
  Match.when("Right", () => "right" as const),
  Match.when("None", () => null),
  Match.exhaustive
);

export const documentRoot = (
  document: MarkdownDocument,
  target: ComponentTarget,
  registry: ComponentRegistry,
  options: Partial<ComponentRenderContext> = {},
  layouts: readonly ListLayout[] = []
): Root => {
  const context = componentContext(options);
  const cursor = { list: 0 };

  const blockNodes = (
    node: Block
  ): readonly (BlockContent | DefinitionContent)[] =>
    Match.value(node).pipe(
      Match.withReturnType<readonly (BlockContent | DefinitionContent)[]>(),
      Match.tagsExhaustive({
        Blockquote: ({ blocks }) => [
          { children: blocks.flatMap(blockNodes), type: "blockquote" },
        ],
        CodeBlock: ({ maybeLanguage, maybeMeta, value }) => {
          const code = {
            lang: Option.getOrUndefined(maybeLanguage),
            meta: Option.getOrUndefined(maybeMeta),
            type: "code",
            value,
          } as const;

          return (code.meta ?? "") === ""
            ? [code]
            : renderComponent(
                registry,
                target,
                {
                  attributes: { key: codeIdentity(code) },
                  children: contentRoot([]),
                  name: "Code",
                  placement: "block",
                },
                context
              ).map(requireBlock);
        },
        Heading: ({ content, level }) => [
          { children: content.map(inlineNode), depth: level, type: "heading" },
        ],
        Island: ({ attributes, blocks, name }) =>
          renderComponent(
            registry,
            target,
            {
              attributes,
              children: contentRoot(blocks.flatMap(blockNodes)),
              name,
              placement: "block",
            },
            context
          ).map(requireBlock),
        List: ({ isOrdered, items, maybeStartNumber }) => {
          const layout = layouts[cursor.list];
          cursor.list += 1;

          return [
            {
              children: items.map((item, index) => ({
                children: item.blocks.flatMap(blockNodes),
                spread: layout?.items[index],
                type: "listItem",
              })),
              ordered: isOrdered,
              spread: layout?.spread,
              start: Option.getOrUndefined(maybeStartNumber),
              type: "list",
            },
          ];
        },
        Paragraph: ({ content }) => [
          { children: content.map(inlineNode), type: "paragraph" },
        ],
        Table: ({ alignments, bodyRows, headerRow }) => [
          {
            align: alignments.map(alignmentValue),
            children: [headerRow, ...bodyRows].map((row) => ({
              children: row.cells.map((cell) => ({
                children: cell.content.map(inlineNode),
                type: "tableCell",
              })),
              type: "tableRow",
            })),
            type: "table",
          },
        ],
        ThematicBreak: () => [{ type: "thematicBreak" }],
      })
    );

  return contentRoot(document.blocks.flatMap(blockNodes));
};

export const documentMarkdown = (
  document: MarkdownDocument,
  registry: ComponentRegistry,
  options: Partial<ComponentRenderContext> = {},
  layouts: readonly ListLayout[] = []
) =>
  stringifyContentMarkdown(
    documentRoot(document, "agent", registry, options, layouts)
  );
