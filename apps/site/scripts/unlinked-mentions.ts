import { Schema } from "effect";
import { unified } from "unified";

import type { GlossaryEntry } from "./content-lib.ts";

export const UnlinkedMentionsSchema = Schema.Array(
  Schema.Struct({
    context: Schema.String,
    from: Schema.String,
    target: Schema.String,
    term: Schema.String,
    title: Schema.String,
  })
);

export type UnlinkedMention = (typeof UnlinkedMentionsSchema.Type)[number];

interface MentionNode {
  readonly type: string;
  readonly tagName?: string;
  readonly value?: string;
  readonly children?: readonly MentionNode[];
}

export interface UnlinkedProse {
  readonly text: string;
  readonly context: string;
  readonly offset: number;
}

export interface MentionPage {
  readonly route: string;
  readonly title: string;
  readonly prose: readonly UnlinkedProse[];
}

const headingLevels = new Map([
  ["h1", 1],
  ["h2", 2],
  ["h3", 3],
  ["h4", 4],
  ["h5", 5],
  ["h6", 6],
]);

const contextTags = new Set(["p", "li"]);

const skippedTags = new Set([
  "a",
  "blockquote",
  "code",
  "pre",
  "table",
  "nav",
  "script",
  "style",
  ...headingLevels.keys(),
]);

const nodeText = (node: MentionNode): string =>
  node.type === "text"
    ? (node.value ?? "")
    : (node.children ?? []).map(nodeText).join("");

const textProse = (
  node: MentionNode,
  context: string,
  offset: number
): UnlinkedProse | undefined => {
  if (
    node.type !== "text" ||
    node.value === undefined ||
    node.value.trim() === ""
  ) {
    return undefined;
  }

  return {
    context: context === "" ? node.value : context,
    offset: context === "" ? 0 : offset,
    text: node.value,
  };
};

export const collectUnlinkedProse = (prose: UnlinkedProse[]) => {
  const visit = (node: MentionNode, parentContext = "", parentOffset = 0) => {
    const context = contextTags.has(node.tagName ?? "")
      ? nodeText(node)
      : parentContext;

    const offset = context === parentContext ? parentOffset : 0;

    if (node.tagName !== undefined && skippedTags.has(node.tagName)) {
      return;
    }

    const text = textProse(node, context, offset);

    if (text !== undefined) {
      prose.push(text);

      return;
    }

    let sourcesLevel = 0;
    let childOffset = offset;

    for (const child of node.children ?? []) {
      const headingLevel = headingLevels.get(child.tagName ?? "") ?? 0;

      if (headingLevel > 0) {
        if (headingLevel <= sourcesLevel) {
          sourcesLevel = 0;
        }

        if (nodeText(child).trim().toLowerCase() === "sources") {
          sourcesLevel = headingLevel;
        }
      }

      if (sourcesLevel === 0) {
        visit(child, context, childOffset);
      }

      childOffset += nodeText(child).length;
    }
  };

  const processor = unified().use(() => (tree: MentionNode) => {
    visit(tree);
  });

  return () => (tree: MentionNode) => {
    processor.runSync(tree);
  };
};

const escapeRegex = (text: string) =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const snippet = (text: string, index: number, length: number) => {
  const before = text.slice(0, index);
  const sentenceStart = before.search(/[^.!?]*$/u);
  const after = text.slice(index + length).split(/(?<=[.!?])\s/u)[0] ?? "";

  const sentence =
    `${before.slice(sentenceStart)}${text.slice(index, index + length)}${after}`
      .replaceAll(/\s+/gu, " ")
      .trim();

  if (sentence.length <= 320) {
    return sentence;
  }

  const start = Math.max(0, index - sentenceStart - 100);

  return `${start > 0 ? "…" : ""}${sentence.slice(start, start + 317).trim()}…`;
};

export const findUnlinkedMentions = (
  pages: readonly MentionPage[],
  terms: readonly GlossaryEntry[]
): readonly UnlinkedMention[] => {
  const mentions: UnlinkedMention[] = [];

  for (const page of pages) {
    const found = new Set<string>();

    for (const entry of terms) {
      if (entry.routePath === page.route || found.has(entry.routePath)) {
        continue;
      }

      const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}_])${escapeRegex(entry.term)}(?![\\p{L}\\p{N}_])`,
        "iu"
      );

      for (const segment of page.prose) {
        const match = pattern.exec(segment.text);

        if (match !== null) {
          mentions.push({
            context: snippet(
              segment.context,
              segment.offset + match.index,
              match[0].length
            ),
            from: page.route,
            target: entry.routePath,
            term: entry.term,
            title: page.title,
          });
          found.add(entry.routePath);
          break;
        }
      }
    }
  }

  return mentions.toSorted(
    (left, right) =>
      left.target.localeCompare(right.target) ||
      left.title.localeCompare(right.title)
  );
};
