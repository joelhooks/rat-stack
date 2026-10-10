import { CodeBuildFailed } from "@rat-stack/code-snippets";
import type { CodeFence, CodeSnippet, Token } from "@rat-stack/code-snippets";
import type { RootContent } from "mdast";

import type { ComponentDefinition } from "./component-registry.ts";
import { parseContentMarkdown, visitContentNodes } from "./svx-ast.ts";

export const collectCodeFences = (
  source: string,
  sourcePath: string
): readonly CodeFence[] => {
  const nodes: CodeFence[] = [];
  visitContentNodes(parseContentMarkdown(source, sourcePath), (node) => {
    if (node.type === "code") {
      nodes.push({
        lang: node.lang,
        line: node.position?.start.line ?? 1,
        meta: node.meta,
        value: node.value,
      });
    }
  });

  return nodes;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;")
    .replaceAll("`", "&#96;");

const tokenColor = (role: string) => {
  if (role === "muted") {
    return "var(--code-muted)";
  }

  if (role === "keyword") {
    return "var(--code-keyword)";
  }

  if (role === "literal") {
    return "var(--code-literal)";
  }

  return "var(--code-ink)";
};

const tokenStyle = (token: Token) =>
  [
    `color:${token.color ?? tokenColor(token.role)}`,
    token.fontStyle % 2 === 1 ? "font-style:italic" : "",
    Math.floor(token.fontStyle / 2) % 2 === 1 ? "font-weight:bold" : "",
    Math.floor(token.fontStyle / 4) % 2 === 1
      ? "text-decoration:underline"
      : "",
  ]
    .filter(Boolean)
    .join(";");

const snippetProvenance = (snippet: CodeSnippet) => {
  const { request } = snippet;

  const ranges = request.ranges
    .map((range) => `${range.start}-${range.end}`)
    .join(",");

  const highlights =
    request.highlights
      .map((range) =>
        range.start === range.end
          ? `${range.start}`
          : `${range.start}-${range.end}`
      )
      .join(",") || "none";

  if (request.reference) {
    const title =
      request.title === request.path.split("/").at(-1)
        ? ""
        : ` Title: ${request.title}.`;

    return `${request.path} at ${request.commit}; lines ${ranges}; highlighted ${highlights}.${title}`;
  }

  return `${request.title}; lines ${ranges}; highlighted ${highlights}.`;
};

export const snippetHtml = (snippet: CodeSnippet) => {
  const { request } = snippet;

  const label = request.reference
    ? `${request.path} · ${request.commit.slice(0, 8)}`
    : request.title;

  const title =
    request.reference && request.title !== request.path.split("/").at(-1)
      ? ` · ${request.title}`
      : "";

  const header =
    snippet.url === ""
      ? escapeHtml(label + title)
      : `<a href="${escapeHtml(snippet.url)}">${escapeHtml(label + title)}</a>`;

  const lines = snippet.lines
    .map(
      (line) =>
        `${line.gapBefore > 0 ? `<span class="code-gap" aria-label="${line.gapBefore} omitted lines" data-label="⋯ ${line.gapBefore} lines"></span>` : ""}<span class="code-line${line.highlighted ? " code-highlighted" : ""}"><span class="code-number" aria-hidden="true" data-line="${line.number}"></span><span class="code-text">${line.tokens.map((token) => `<span style="${escapeHtml(tokenStyle(token))}">${escapeHtml(token.text)}</span>`).join("")}</span></span>`
    )
    .join("\n");

  return `<figure class="code-snippet"><figcaption title="${escapeHtml(snippetProvenance(snippet))}">${header}</figcaption><pre><code class="language-${escapeHtml(request.language)}">${lines}</code></pre></figure>`;
};

export const snippetAgent = (snippet: CodeSnippet): readonly RootContent[] => {
  const { request } = snippet;

  const provenance = snippetProvenance(snippet);

  return [
    { children: [{ type: "text", value: provenance }], type: "paragraph" },
    {
      lang: request.language,
      type: "code",
      value: snippet.lines.map((line) => line.text).join("\n"),
    },
  ];
};

export const codeComponent = (
  snippets: ReadonlyMap<string, CodeSnippet>
): ComponentDefinition => {
  const find = (key: string | undefined) => {
    const snippet = snippets.get(key ?? "");

    if (snippet === undefined) {
      throw new CodeBuildFailed({
        messages: [
          "Configured code fence was not preflighted; run the code pipeline before rendering.",
        ],
      });
    }

    return snippet;
  };

  return {
    agent: (input) => snippetAgent(find(input.attributes.key)),
    human: (input) => [
      { type: "html", value: snippetHtml(find(input.attributes.key)) },
    ],
  };
};
