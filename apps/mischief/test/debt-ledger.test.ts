import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { DomUtils, parseDocument } from "htmlparser2";
import type { Nodes, Table, TableCell } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import {
  buildError,
  debtLedgerMarkdown,
  deriveHtmlMarkdown,
} from "../scripts/content-lib.ts";
import { renderMarkdownHtml } from "../scripts/markdown-html.ts";

const proseWithTags = [
  "a",
  "b",
  " ",
  "\t",
  "void",
  "<",
  ">",
  "|",
  "<void>",
  "<b>",
  "</b>",
  "<!--",
  "-->",
  "<a href=x>",
  "<b x=y>",
  "Promise<void>",
] as const;

const htmlSafeSyntax = [
  "a",
  "b",
  " ",
  "\t",
  "void",
  "<",
  ">",
  "|",
  "<void>",
  "<b>",
  "</b>",
  "<a href=x>",
  "<b x=y>",
  "Promise<void>",
  "&",
  "#",
  ";",
  "[",
  "]",
  "(",
  ")",
  "\\",
  "[a](b)",
  "`<b>`",
] as const;

const markdownSyntax = [...htmlSafeSyntax, "<!--", "-->"] as const;

const cellText = (characters: readonly string[]) =>
  Arbitrary.array(Arbitrary.schema(Schema.Literals(characters)), {
    maxLength: 16,
    minLength: 1,
  }).pipe(Arbitrary.map((parts) => parts.join("")));

const ledgerFor = (directive: string, reason: string) =>
  debtLedgerMarkdown([
    { directive, file: "apps/sample.ts", kind: "oxlint", line: 3, reason },
  ]);

const ledgerCells = (markdown: string): readonly TableCell[] =>
  unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(markdown)
    .children.findLast((node): node is Table => node.type === "table")
    ?.children[1]?.children ?? [];

const nodeTypes = (node: Nodes): readonly string[] => [
  node.type,
  ...("children" in node
    ? node.children.flatMap((child) => nodeTypes(child))
    : []),
];

const visibleText = (node: Nodes): string => {
  if (node.type === "text" || node.type === "inlineCode") {
    return node.value;
  }

  return "children" in node
    ? node.children.map((child) => visibleText(child)).join("")
    : "";
};

const collapsed = (value: string) => value.replaceAll(/\s+/gu, " ").trim();

it.prop(
  "no debt directive or reason reaches agent Markdown as raw HTML",
  {
    directive: cellText([...markdownSyntax, "&amp;", "{", "}"]),
    reason: cellText([...markdownSyntax, "&amp;", "{", "}"]),
  },
  ({ directive, reason }) => {
    const cells = ledgerCells(ledgerFor(directive, reason));

    expect(cells).toHaveLength(3);
    expect(cells.flatMap((cell) => nodeTypes(cell))).not.toContain("html");
  },
  { arbitrary: { runs: 500 } }
);

it.prop(
  "prose with tags in a debt reason keeps every character",
  {
    directive: cellText(proseWithTags),
    reason: cellText(proseWithTags),
  },
  ({ directive, reason }) => {
    const cells = ledgerCells(ledgerFor(directive, reason));

    expect(cells.map((cell) => visibleText(cell))).toEqual([
      "apps/sample.ts:3",
      collapsed(directive),
      collapsed(reason),
    ]);
  },
  { arbitrary: { runs: 500 } }
);

it.effect.prop(
  "the HTML ledger shows the same cell text as the agent Markdown",
  {
    directive: cellText(htmlSafeSyntax),
    reason: cellText(htmlSafeSyntax),
  },
  ({ directive, reason }) =>
    Effect.gen(function* rendersCells() {
      const markdown = ledgerFor(directive, reason);

      const html = yield* Effect.try({
        catch: (cause) => buildError("debt ledger html", "debt.md", cause),
        try: () =>
          renderMarkdownHtml(deriveHtmlMarkdown(markdown), {
            sourcePath: "debt.md",
          }),
      });

      const rows = DomUtils.getElementsByTagName(
        "tr",
        parseDocument(html).children
      );

      const cells = DomUtils.getElementsByTagName("td", rows.at(-1) ?? []);

      const inlineElements = new Set(["a", "code", "del", "em", "strong"]);

      expect(
        cells
          .flatMap((cell) => DomUtils.getElementsByTagName("*", cell.children))
          .map((element) => element.name)
          .filter((name) => !inlineElements.has(name))
      ).toEqual([]);
      expect(cells.map((cell) => DomUtils.textContent(cell))).toEqual(
        ledgerCells(markdown).map((cell) => visibleText(cell))
      );
    }),
  { arbitrary: { runs: 300 } }
);
