import { ElementType, parseDocument } from "htmlparser2";

const blockTags = new Set([
  "article",
  "br",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "main",
  "p",
  "section",
  "ul",
  "ol",
]);

export const rawReaderTables = (html: string) => {
  const document = parseDocument(html, { withStartIndices: true });
  const findings: { line: number; text: string }[] = [];
  let text = "";
  let line = 1;

  const flush = () => {
    const trimmed = text.trim();

    if (/^\|.*\|$/u.test(trimmed) || /\|\s*:?-{3,}:?\s*\|/u.test(trimmed)) {
      findings.push({
        line,
        text: trimmed,
      });
    }

    text = "";
  };

  const visit = (node: (typeof document.children)[number]) => {
    if (
      node.type === ElementType.Tag ||
      node.type === ElementType.Script ||
      node.type === ElementType.Style
    ) {
      if (["pre", "code", "script", "style"].includes(node.name)) {
        return;
      }

      const block = blockTags.has(node.name);

      if (block) {
        flush();
      }

      for (const child of node.children) {
        visit(child);
      }

      if (block) {
        flush();
      }
    } else if (node.type === ElementType.Text) {
      for (const [index, part] of node.data.split("\n").entries()) {
        if (index > 0) {
          flush();
        }

        if (text.length === 0) {
          line = html.slice(0, node.startIndex ?? 0).split("\n").length + index;
        }

        text += part;
      }
    }
  };

  for (const node of document.children) {
    visit(node);
  }

  flush();

  return findings;
};
