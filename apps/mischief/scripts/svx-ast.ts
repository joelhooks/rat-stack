import { Schema } from "effect";
import { Parser } from "htmlparser2";
import type { Nodes, PhrasingContent, Root, RootContent, Text } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import type { Options as StringifyOptions } from "remark-stringify";
import { unified } from "unified";
import type { Node } from "unist";
import { parse as parseYaml } from "yaml";

import { buildError } from "./content-error.ts";

export interface SvxYaml extends Node {
  type: "yaml";
  value: string;
}

declare module "mdast" {
  interface RootContentMap {
    yaml: SvxYaml;
  }
}

const frontmatterSchema = Schema.JsonObject;

const stringifyOptions = {
  bullet: "-",
  fences: true,
  handlers: {
    yaml: (node: Nodes) => {
      if (node.type !== "yaml") {
        throw buildError(
          "frontmatter stringify",
          "<inline>",
          new Error("Expected a yaml node")
        );
      }

      return `---\n${node.value}\n---`;
    },
  },
  listItemIndent: "one",
} as const;

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkStringify, stringifyOptions);

const textWithEncodedMarkup: NonNullable<
  NonNullable<StringifyOptions["handlers"]>["text"]
> = (node: Text, _parent, state, info) =>
  state.safe(node.value, { ...info, encode: ["&", "<"] });

const characterReference = (character: string) =>
  `&#x${(character.codePointAt(0) ?? 0).toString(16).toUpperCase()};`;

const htmlCodeWithPipes = (
  children: readonly PhrasingContent[]
): PhrasingContent[] =>
  children.map((child) => {
    if (child.type === "inlineCode" && child.value.includes("|")) {
      return {
        type: "html",
        value: `<code>${child.value.replaceAll(/[&<>{|}]/gu, characterReference)}</code>`,
      };
    }

    return "children" in child
      ? { ...child, children: htmlCodeWithPipes(child.children) }
      : child;
  });

const sourceMarkdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkStringify, {
    ...stringifyOptions,
    handlers: {
      ...stringifyOptions.handlers,
      text: textWithEncodedMarkup,
    },
    unsafe: [{ character: "&", inConstruct: "phrasing" }],
  });

export const scanLeadingFrontmatterFence = (
  source: string,
  sourcePath: string
) => {
  const lines = source.split("\n");

  if (lines[0]?.trimEnd() !== "---") {
    return { body: source, offset: 0, prefixLines: 0, yaml: undefined };
  }

  const closing = lines.findIndex(
    (line, index) => index > 0 && line.trimEnd() === "---"
  );

  if (closing === -1) {
    throw buildError(
      "frontmatter fence",
      sourcePath,
      new Error("Leading frontmatter must have a closing --- fence")
    );
  }

  const prefix = lines.slice(0, closing + 1).join("\n");
  const offset = prefix.length + (closing < lines.length - 1 ? 1 : 0);

  const yaml: SvxYaml = {
    type: "yaml",
    value: lines
      .slice(1, closing)
      .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
      .join("\n"),
  };

  return { body: source.slice(offset), offset, prefixLines: closing + 1, yaml };
};

export const visitContentNodes = (
  node: Nodes,
  visit: (node: Nodes) => void
): void => {
  visit(node);

  if ("children" in node) {
    for (const child of node.children) {
      visitContentNodes(child, visit);
    }
  }
};

export const parseContentMarkdown = (
  source: string,
  sourcePath = "<inline>"
): Root => {
  const leading = scanLeadingFrontmatterFence(source, sourcePath);
  const root = processor.parse(leading.body);

  visitContentNodes(root, (node) => {
    if (node.position !== undefined) {
      node.position.start.line += leading.prefixLines;
      node.position.end.line += leading.prefixLines;

      if (node.position.start.offset !== undefined) {
        node.position.start.offset += leading.offset;
      }

      if (node.position.end.offset !== undefined) {
        node.position.end.offset += leading.offset;
      }
    }
  });

  if (leading.yaml !== undefined) {
    root.children.unshift(leading.yaml);
  }

  return root;
};

export const stringifyContentMarkdown = (root: Root) =>
  processor.stringify(root);

export const stringifySourceMarkdown = (root: Root) => {
  visitContentNodes(root, (node) => {
    if (node.type === "tableCell") {
      node.children = htmlCodeWithPipes(node.children);
    }
  });

  return sourceMarkdownProcessor.stringify(root);
};

export const frontmatterData = (
  source: string,
  sourcePath = "<inline>"
): typeof frontmatterSchema.Type => {
  const leading = scanLeadingFrontmatterFence(source, sourcePath);

  if (leading.yaml === undefined || leading.yaml.value.trim() === "") {
    return {};
  }

  try {
    return Schema.decodeUnknownSync(frontmatterSchema)(
      parseYaml(leading.yaml.value)
    );
  } catch (error) {
    throw buildError("frontmatter YAML", sourcePath, error);
  }
};

export interface HtmlToken {
  readonly attributes: Readonly<Record<string, string>>;
  readonly end: number;
  readonly kind: "open" | "close";
  readonly name: string;
  readonly selfClosing: boolean;
  readonly quotedAttributes: readonly string[];
  readonly start: number;
}

export const htmlPlainText = (html: string): string => {
  const text: string[] = [];
  const boundaries = new Set(["br", "div", "li", "ol", "p", "pre", "ul"]);

  const parser = new Parser(
    {
      onclosetag(name) {
        if (boundaries.has(name)) {
          text.push("\n");
        }
      },
      onopentag(name) {
        if (boundaries.has(name)) {
          text.push("\n");
        }
      },
      ontext(value) {
        text.push(value);
      },
    },
    { decodeEntities: true, xmlMode: true }
  );

  parser.end(html);

  return text.join("");
};

export const htmlTokens = (html: string): readonly HtmlToken[] => {
  const tokens: HtmlToken[] = [];
  let selfClosingName = "";
  let quotedAttributes: string[] = [];

  const parser = new Parser(
    {
      onattribute(name, _value, quote) {
        if (quote === '"' || quote === "'") {
          quotedAttributes.push(name);
        }
      },
      onclosetag(name, implied) {
        if (selfClosingName === name) {
          selfClosingName = "";

          return;
        }

        if (!implied) {
          tokens.push({
            attributes: {},
            end: parser.endIndex + 1,
            kind: "close",
            name,
            quotedAttributes: [],
            selfClosing: false,
            start: parser.startIndex,
          });
        }
      },
      onopentag(name, attributes) {
        const start = parser.startIndex;
        const end = parser.endIndex + 1;
        const selfClosing = html.slice(start, end).endsWith("/>");
        selfClosingName = selfClosing ? name : "";
        tokens.push({
          attributes,
          end,
          kind: "open",
          name,
          quotedAttributes: [...quotedAttributes],
          selfClosing,
          start,
        });
      },
      onopentagname() {
        quotedAttributes = [];
      },
    },
    {
      decodeEntities: true,
      lowerCaseAttributeNames: false,
      lowerCaseTags: false,
      xmlMode: true,
    }
  );

  parser.write(html);
  parser.end();

  return tokens;
};

export const countHtmlElements = (html: string, name: string) =>
  htmlTokens(html).filter(
    (token) => token.kind === "open" && token.name.toLowerCase() === name
  ).length;

export const contentCodeSpans = (source: string): readonly string[] => {
  const spans: string[] = [];
  visitContentNodes(parseContentMarkdown(source), (node) => {
    if (node.type === "inlineCode") {
      spans.push(node.value);
    }
  });

  return spans;
};

export const contentLinkHrefs = (
  source: string,
  includeImages = true
): readonly string[] => {
  const root = parseContentMarkdown(source);
  const definitions = new Map<string, string>();
  const hrefs = new Set<string>();
  visitContentNodes(root, (node) => {
    if (node.type === "definition") {
      definitions.set(node.identifier, node.url);
    }
  });
  visitContentNodes(root, (node) => {
    if (node.type === "link" || (includeImages && node.type === "image")) {
      hrefs.add(node.url);
    } else if (
      node.type === "linkReference" ||
      (includeImages && node.type === "imageReference")
    ) {
      const href = definitions.get(node.identifier);

      if (href !== undefined) {
        hrefs.add(href);
      }
    } else if (node.type === "html") {
      for (const token of htmlTokens(node.value)) {
        for (const field of includeImages ? ["href", "src"] : ["href"]) {
          const href = token.attributes[field];

          if (
            href !== undefined &&
            (token.quotedAttributes.includes(field) ||
              !(href.startsWith("{") && href.endsWith("}")))
          ) {
            hrefs.add(href);
          }
        }
      }
    }
  });

  return [...hrefs];
};

export const contentHeadings = (source: string, depth: number) => {
  const headings: string[] = [];
  visitContentNodes(parseContentMarkdown(source), (node) => {
    if (node.type === "heading" && node.depth === depth) {
      let text = "";
      visitContentNodes(node, (child) => {
        if (child.type === "text" || child.type === "inlineCode") {
          text += child.value;
        }
      });
      headings.push(text);
    }
  });

  return headings;
};

export const contentRoot = (children: readonly RootContent[]): Root => ({
  children: [...children],
  type: "root",
});

interface TextReplacement {
  readonly end: number;
  readonly start: number;
  readonly value: string;
}

const replaceTextSpans = (
  source: string,
  replacements: readonly TextReplacement[]
) => {
  let result = source;

  for (const replacement of replacements.toSorted(
    (left, right) => right.start - left.start
  )) {
    result =
      result.slice(0, replacement.start) +
      replacement.value +
      result.slice(replacement.end);
  }

  return result;
};

const htmlCommentSpans = (html: string): readonly TextReplacement[] => {
  const replacements: TextReplacement[] = [];

  const parser = new Parser(
    {
      oncomment() {
        replacements.push({
          end: parser.endIndex + 1,
          start: parser.startIndex,
          value: "",
        });
      },
    },
    { xmlMode: true }
  );

  parser.end(html);

  return replacements;
};

export const stripHtmlComments = (html: string) =>
  replaceTextSpans(html, htmlCommentSpans(html));

export const stripContentComments = (source: string): string => {
  const replacements: TextReplacement[] = [];
  visitContentNodes(parseContentMarkdown(source), (node) => {
    if (
      node.type === "html" &&
      node.position?.start.offset !== undefined &&
      node.position.end.offset !== undefined
    ) {
      const { offset } = node.position.start;

      for (const span of htmlCommentSpans(
        source.slice(offset, node.position.end.offset)
      )) {
        replacements.push({
          ...span,
          end: offset + span.end,
          start: offset + span.start,
        });
      }
    }
  });

  return replaceTextSpans(source, replacements);
};

export const normalizeHtmlAttributeNewlines = (
  html: string,
  attribute: string
): string => {
  const replacements: TextReplacement[] = [];

  const parser = new Parser(
    {
      onattribute(name, _value, quote) {
        if (name === attribute && (quote === '"' || quote === "'")) {
          const start = html.indexOf(quote, parser.startIndex) + 1;
          const end = html.indexOf(quote, start);
          replacements.push({
            end,
            start,
            value: html.slice(start, end).replaceAll("\n", "&#10;"),
          });
        }
      },
    },
    { xmlMode: true }
  );

  parser.end(html);

  return replaceTextSpans(html, replacements);
};
