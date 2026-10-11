import type { Nodes } from "mdast";

import type { GlossaryEntry } from "./content-lib.ts";
import { parseContentMarkdown } from "./svx-ast.ts";

interface ProsePart {
  readonly text: string;
  readonly linked: boolean;
}

export interface GlossaryFirstUseWarning {
  readonly file: string;
  readonly line: number;
  readonly term: string;
  readonly target: string;
}

const excluded = new Set(["blockquote", "code", "inlineCode", "table", "yaml"]);

const proseParts = (node: Nodes, linked = false): readonly ProsePart[] => {
  if (excluded.has(node.type)) {
    return [];
  }

  if (node.type === "text") {
    return [{ linked, text: node.value }];
  }

  return "children" in node
    ? node.children.flatMap((child) =>
        proseParts(
          child,
          linked || node.type === "link" || node.type === "linkReference"
        )
      )
    : [];
};

export const glossaryFirstUseWarnings = (
  file: string,
  source: string,
  terms: readonly GlossaryEntry[]
): readonly GlossaryFirstUseWarning[] => {
  const warnings: GlossaryFirstUseWarning[] = [];
  const seen = new Set<string>();

  const patterns = terms.map((entry) => ({
    entry,
    pattern: new RegExp(
      `(?<![\\p{L}\\p{N}_])${entry.term.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![\\p{L}\\p{N}_])`,
      "iu"
    ),
  }));

  const visit = (node: Nodes): void => {
    if (excluded.has(node.type)) {
      return;
    }

    if (node.type === "paragraph") {
      const parts = proseParts(node);
      const text = parts.map((part) => part.text).join("");

      for (const { entry, pattern } of patterns) {
        const key = entry.term.toLowerCase();
        const match = pattern.exec(text);

        if (seen.has(key) || match === null) {
          continue;
        }

        seen.add(key);
        let offset = 0;

        const linked = parts.some((part) => {
          const contains =
            match.index >= offset && match.index < offset + part.text.length;

          offset += part.text.length;

          return contains && part.linked;
        });

        const defined = /^\s*(?:is\b|are\b|means\b|refers to\b|:)/iu.test(
          text.slice(match.index + match[0].length)
        );

        if (!linked && !defined) {
          warnings.push({
            file,
            line: node.position?.start.line ?? 1,
            target: entry.routePath,
            term: entry.term,
          });
        }
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

export const glossaryFirstUseWarningText = (
  warning: GlossaryFirstUseWarning
): string =>
  `${warning.file}:${warning.line}: glossary first use: "${warning.term}" needs a definition or link (${warning.target})`;
