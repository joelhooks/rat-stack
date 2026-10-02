import type { Nodes } from "mdast";

import { parseContentMarkdown } from "./svx-ast.ts";

export interface WikiProseWarning {
  readonly count: number;
  readonly file: string;
  readonly kind: "paragraph" | "sentence";
  readonly limit: number;
  readonly line: number;
}

const sentenceSegments = new Intl.Segmenter("en", { granularity: "sentence" });

const wordSegments = new Intl.Segmenter("en", { granularity: "word" });

const excluded = new Set(["blockquote", "code", "inlineCode", "table", "yaml"]);

const proseText = (node: Nodes): string => {
  if (excluded.has(node.type)) {
    return "";
  }

  if (node.type === "text") {
    return node.value;
  }

  return "children" in node ? node.children.map(proseText).join("") : "";
};

export const wikiProseWarnings = (
  file: string,
  source: string
): readonly WikiProseWarning[] => {
  const warnings: WikiProseWarning[] = [];

  const visit = (node: Nodes): void => {
    if (excluded.has(node.type)) {
      return;
    }

    if (node.type === "paragraph") {
      const sentences = [...sentenceSegments.segment(proseText(node))].filter(
        ({ segment }) =>
          [...wordSegments.segment(segment)].some(
            (word) => word.isWordLike === true
          )
      );

      const line = node.position?.start.line ?? 1;

      for (const { segment } of sentences) {
        const count = [...wordSegments.segment(segment)].filter(
          (word) => word.isWordLike === true
        ).length;

        if (count > 25) {
          warnings.push({ count, file, kind: "sentence", limit: 25, line });
        }
      }

      if (sentences.length > 4) {
        warnings.push({
          count: sentences.length,
          file,
          kind: "paragraph",
          limit: 4,
          line,
        });
      }

      return;
    }

    if ("children" in node) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };

  visit(parseContentMarkdown(source, file));

  return warnings;
};

export const wikiProseWarningText = (warning: WikiProseWarning): string =>
  `${warning.file}:${warning.line}: wiki prose: ${warning.kind} has ${warning.count} ${warning.kind === "sentence" ? "words" : "sentences"} (aim ≤${warning.limit})`;
