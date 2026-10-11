import type { Nodes } from "mdast";

export interface WikiProseStyleWarning {
  readonly file: string;
  readonly kind: "em-dash" | "hedge" | "history";
  readonly line: number;
  readonly match: string;
}

const excluded = new Set([
  "blockquote",
  "code",
  "definition",
  "html",
  "inlineCode",
  "link",
  "linkReference",
  "table",
  "yaml",
]);

const patterns: readonly {
  readonly kind: WikiProseStyleWarning["kind"];
  readonly pattern: RegExp;
}[] = [
  {
    kind: "history",
    pattern:
      /\b(?:previously|used[ \t]+to|no[ \t]+longer|formerly|for[ \t]+now|will[ \t]+be[ \t]+replaced)\b/giu,
  },
  {
    kind: "hedge",
    pattern:
      /\b[^\s,.;:\n\uFFFC]+,[ \t]*not[ \t]+[^\s,.;:\n\uFFFC]+|\bnot[ \t]+[^,.;:\n\uFFFC]+,[ \t]*but\b/giu,
  },
  { kind: "em-dash", pattern: /—/gu },
];

const quoted = /"[^"]*"|“[^”]*”|(?<!\p{L})'[^'\n]+'(?!\p{L})|‘[^’\n]+’/gu;

export const wikiProseStyleWarnings = (
  file: string,
  source: string,
  root: Nodes
): readonly WikiProseStyleWarning[] => {
  const characters: string[] = Array.from(
    { length: source.length },
    (_, index) => (source.charAt(index) === "\n" ? "\n" : " ")
  );

  const visit = (node: Nodes): void => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;

    if (excluded.has(node.type)) {
      if (start !== undefined && end !== undefined) {
        for (let index = start; index < end; index += 1) {
          if (source[index] !== "\n") {
            characters[index] = "\uFFFC";
          }
        }
      }

      return;
    }

    if (node.type === "text" && start !== undefined && end !== undefined) {
      for (let index = start; index < end; index += 1) {
        characters[index] = source.charAt(index);
      }
    }

    if ("children" in node) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };

  visit(root);

  const prose = characters
    .join("")
    .replace(quoted, (span) => span.replaceAll(/[^\n]/gu, "\uFFFC"));

  return prose.split("\n").flatMap((text, index) =>
    patterns.flatMap(({ kind, pattern }) =>
      [...text.matchAll(pattern)].map((match) => ({
        file,
        kind,
        line: index + 1,
        match: match[0],
      }))
    )
  );
};
