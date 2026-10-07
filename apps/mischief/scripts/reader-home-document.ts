import { Data, Predicate } from "effect";
import type { PhrasingContent, RootContent } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { linkLoreTerms } from "./content-lib.ts";
import type { LoreHastNode, LoreTermTarget } from "./content-lib.ts";
import { linkStackEntities } from "./content-links.ts";

type ParsedInline = Data.TaggedEnum<{
  Code: { readonly value: string };
  Emphasis: { readonly content: readonly ParsedInline[] };
  Link: { readonly href: string; readonly value: string };
  Strong: { readonly content: readonly ParsedInline[] };
  Text: { readonly value: string };
}>;

const Inline = Data.taggedEnum<ParsedInline>();

type HomeBlock = Data.TaggedEnum<{
  CodeFence: {
    readonly language: string;
    readonly meta: string;
    readonly value: string;
  };
  CopyPrompt: { readonly id: string };
  Diagram: { readonly alt: string; readonly value: string };
  Heading: {
    readonly id: string;
    readonly level: number;
    readonly title: string;
  };
  List: { readonly items: readonly (readonly ParsedInline[])[] };
  Paragraph: { readonly content: readonly ParsedInline[] };
}>;

const Block = Data.taggedEnum<HomeBlock>();

const plainInline = (node: PhrasingContent): string => {
  if (node.type === "text" || node.type === "inlineCode") {
    return node.value;
  }

  if (
    node.type === "emphasis" ||
    node.type === "strong" ||
    node.type === "link"
  ) {
    return node.children.map(plainInline).join("");
  }

  throw new Error(
    `Unsupported home inline ${node.type} at line ${node.position?.start.line}; add a reader renderer before building`
  );
};

const inlineDocument = (node: PhrasingContent): ParsedInline => {
  if (node.type === "text") {
    return Inline.Text({ value: node.value });
  }

  if (node.type === "inlineCode") {
    return Inline.Code({ value: node.value });
  }

  if (node.type === "link") {
    return Inline.Link({
      href: node.url,
      value: node.children.map(plainInline).join(""),
    });
  }

  if (node.type === "emphasis") {
    return Inline.Emphasis({ content: node.children.map(inlineDocument) });
  }

  if (node.type === "strong") {
    return Inline.Strong({ content: node.children.map(inlineDocument) });
  }

  throw new Error(
    `Unsupported home inline ${node.type} at line ${node.position?.start.line}; add a reader renderer before building`
  );
};

const blockDocument = (node: RootContent): HomeBlock => {
  if (node.type === "paragraph") {
    return Block.Paragraph({ content: node.children.map(inlineDocument) });
  }

  if (node.type === "heading") {
    const title = node.children.map(plainInline).join("");

    return Block.Heading({
      id: title
        .toLowerCase()
        .replaceAll(/[^\w -]/gu, "")
        .replaceAll(/\s+/gu, "-"),
      level: node.depth,
      title,
    });
  }

  if (node.type === "code") {
    return Block.CodeFence({
      language: node.lang ?? "",
      meta: node.meta ?? "",
      value: node.value,
    });
  }

  if (node.type === "list") {
    return Block.List({
      items: node.children.map((item) => {
        const paragraph = item.children.at(0);

        if (item.children.length !== 1 || paragraph?.type !== "paragraph") {
          throw new Error(
            `Unsupported home list item at line ${item.position?.start.line}; preserve nested blocks in the reader Document`
          );
        }

        return paragraph.children.map(inlineDocument);
      }),
    });
  }

  throw new Error(
    `Unsupported home block ${node.type} at line ${node.position?.start.line}; add a reader renderer before building`
  );
};

const inlineToTermTree = (node: ParsedInline): LoreHastNode =>
  Inline.$match(node, {
    Code: ({ value }) => ({
      children: [{ type: "text", value }],
      tagName: "code",
      type: "element",
    }),
    Emphasis: ({ content }) => ({
      children: content.map(inlineToTermTree),
      tagName: "em",
      type: "element",
    }),
    Link: ({ href, value }) => ({
      children: [{ type: "text", value }],
      properties: { href },
      tagName: "a",
      type: "element",
    }),
    Strong: ({ content }) => ({
      children: content.map(inlineToTermTree),
      tagName: "strong",
      type: "element",
    }),
    Text: ({ value }) => ({ type: "text", value }),
  });

const termTreeText = (node: LoreHastNode): string =>
  node.value ?? (node.children ?? []).map(termTreeText).join("");

const inlineFromTermTree = (node: LoreHastNode): ParsedInline => {
  if (node.type === "text" && node.value !== undefined) {
    return Inline.Text({ value: node.value });
  }

  const children = node.children ?? [];

  if (node.tagName === "a" && node.properties?.href !== undefined) {
    return Inline.Link({
      href: node.properties.href,
      value: children.map(termTreeText).join(""),
    });
  }

  if (node.tagName === "code") {
    return Inline.Code({ value: children.map(termTreeText).join("") });
  }

  if (node.tagName === "em") {
    return Inline.Emphasis({ content: children.map(inlineFromTermTree) });
  }

  if (node.tagName === "strong") {
    return Inline.Strong({ content: children.map(inlineFromTermTree) });
  }

  throw new Error(
    `Unsupported home term node ${node.tagName ?? node.type}; keep the term tree inside the inline contract`
  );
};

const weaveHomeTerms = (
  blocks: readonly HomeBlock[],
  targets: readonly LoreTermTarget[],
  route: string
) => {
  const children = blocks.map((block): LoreHastNode => {
    if (Predicate.isTagged(block, "Paragraph")) {
      return {
        children: block.content.map(inlineToTermTree),
        tagName: "p",
        type: "element",
      };
    }

    if (Predicate.isTagged(block, "List")) {
      return {
        children: block.items.map((item) => ({
          children: item.map(inlineToTermTree),
          tagName: "li",
          type: "element",
        })),
        tagName: "ul",
        type: "element",
      };
    }

    return { tagName: "pre", type: "element" };
  });

  const termTree = { children, type: "root" };
  linkStackEntities()(termTree);
  linkLoreTerms(targets, route, new Set<string>())()(termTree);

  return blocks.map((block, index) => {
    const woven = children[index]?.children ?? [];

    if (Predicate.isTagged(block, "Paragraph")) {
      return Block.Paragraph({ content: woven.map(inlineFromTermTree) });
    }

    if (Predicate.isTagged(block, "List")) {
      return Block.List({
        items: woven.map((item) =>
          (item.children ?? []).map(inlineFromTermTree)
        ),
      });
    }

    return block;
  });
};

export const compileReaderDocument = (
  source: string,
  targets: readonly LoreTermTarget[],
  page: { readonly heading: string; readonly route: string }
) => {
  const root = unified().use(remarkParse).parse(source);
  const first = root.children.at(0);

  if (
    first?.type !== "heading" ||
    first.depth !== 1 ||
    first.children.map(plainInline).join("") !== page.heading
  ) {
    throw new Error(
      `Reader source for ${page.route} must start with its single ${page.heading} heading`
    );
  }

  const blocks: HomeBlock[] = [];

  for (let index = 1; index < root.children.length; index += 1) {
    const node = root.children[index];

    if (node === undefined) {
      throw new Error("Home parser returned a missing block");
    }

    if (node.type !== "html") {
      blocks.push(blockDocument(node));
      continue;
    }

    const prompt =
      /^<CopyPrompt id="(?<id>connect|mcp|cursor|skills|learn)" \/>$/u.exec(
        node.value.trim()
      );

    if (prompt?.groups?.id !== undefined) {
      blocks.push(Block.CopyPrompt({ id: prompt.groups.id }));
      continue;
    }

    const diagram = /^<Diagram alt="(?<alt>[^"]+)">$/u.exec(node.value.trim());
    const code = root.children[index + 1];
    const closing = root.children[index + 2];

    if (
      diagram?.groups?.alt !== undefined &&
      code?.type === "code" &&
      closing?.type === "html" &&
      closing.value.trim() === "</Diagram>"
    ) {
      blocks.push(
        Block.Diagram({ alt: diagram.groups.alt, value: code.value })
      );
      index += 2;
      continue;
    }

    throw new Error(
      `Unsupported home component at line ${node.position?.start.line}; add an explicit typed component before building`
    );
  }

  return { blocks: weaveHomeTerms(blocks, targets, page.route) };
};
