import { Predicate } from "effect";
import { Parser } from "htmlparser2";
import type {
  Definition,
  ImageReference,
  LinkReference,
  ListItem,
  Nodes,
  Parents,
  Root,
  Table,
} from "mdast";
import type { PluggableList } from "unified";
import { unified } from "unified";
import type { Node, Position } from "unist";

import { buildError } from "./content-error.ts";
import { smartypants } from "./smartypants.ts";
import { parseContentMarkdown, visitContentNodes } from "./svx-ast.ts";

export type HastPropertyValue =
  | boolean
  | number
  | string
  | null
  | undefined
  | readonly (string | number)[];

export interface HastText {
  readonly type: "text";
  value: string;
  position?: Position | undefined;
}

export interface HastRaw {
  readonly type: "raw";
  value: string;
  position?: Position | undefined;
}

export interface HastElement {
  readonly type: "element";
  tagName: string;
  properties: Record<string, HastPropertyValue>;
  children: HastChild[];
  position?: Position | undefined;
}

export type HastChild = HastElement | HastRaw | HastText;

export interface HastRoot {
  readonly type: "root";
  children: HastChild[];
  position?: Position | undefined;
}

export type CodeHighlighter = (
  code: string,
  lang: string | null | undefined
) => string;

export interface MarkdownHtmlOptions {
  readonly highlight?: CodeHighlighter;
  readonly rehypePlugins?: PluggableList;
  readonly sourcePath: string;
}

const urlSafe = new Set(";/?:@&=+$,-_.!~*'()#");

const asciiAlphanumeric = /^[\dA-Za-z]$/u;

const percentEscape = /^%[\dA-Fa-f]{2}/u;

const encodeCharacter = (character: string) => {
  const code = character.codePointAt(0) ?? 0;

  if (code < 128) {
    return asciiAlphanumeric.test(character) || urlSafe.has(character)
      ? character
      : `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
  }

  return code >= 0xd8_00 && code <= 0xdf_ff
    ? "%EF%BF%BD"
    : encodeURIComponent(character);
};

export const encodeUrl = (url: string) => {
  let result = "";
  let index = 0;

  while (index < url.length) {
    const escape = percentEscape.exec(url.slice(index))?.[0];

    if (escape === undefined) {
      const width = (url.codePointAt(index) ?? 0) > 0xff_ff ? 2 : 1;
      result += encodeCharacter(url.slice(index, index + width));
      index += width;
    } else {
      result += escape;
      index += escape.length;
    }
  }

  return result;
};

const text = (value: string, position?: Position): HastText => ({
  position,
  type: "text",
  value,
});

const element = (
  tagName: string,
  entries: readonly (readonly [string, HastPropertyValue])[],
  children: HastChild[],
  position?: Position
): HastElement => ({
  children,
  position,
  properties: Object.fromEntries(entries),
  tagName,
  type: "element",
});

const raw = (value: string, position?: Position): HastRaw => ({
  position,
  type: "raw",
  value,
});

const wrap = (nodes: readonly HastChild[], loose: boolean): HastChild[] => {
  const result: HastChild[] = loose ? [text("\n")] : [];

  for (const [index, node] of nodes.entries()) {
    if (index > 0) {
      result.push(text("\n"));
    }

    result.push(node);
  }

  if (loose && nodes.length > 0) {
    result.push(text("\n"));
  }

  return result;
};

const leadingWhitespace = /^\s+/u;

const lineEndingSpaces = /[ \t]*(?<ending>\r?\n|\r)[ \t]*/gu;

const lineEnding = /\r?\n|\r/gu;

const languageName = /^[^ \t]+(?=[ \t]|$)/u;

const absoluteUrl = /^[A-Za-z][\d+\-.A-Za-z]*:/u;

const windowsPath = /^[A-Za-z]:\\/u;

const htmlBlockStart = /^<\/?[.a-z]*\.?[a-z][\d.a-z]*(?=\s|\/?>|$)/iu;

const externalProtocols = new Set(["http", "https"]);

const isExternalUrl = (url: string) =>
  !windowsPath.test(url) &&
  absoluteUrl.test(url) &&
  externalProtocols.has(url.slice(0, url.indexOf(":")));

interface Converter {
  readonly children: (parent: Parents) => HastChild[];
  readonly definitions: ReadonlyMap<string, Definition>;
  readonly highlight: CodeHighlighter | undefined;
  readonly source: string;
  readonly sourcePath: string;
}

const unsupported = (type: string, converter: Converter) =>
  buildError(
    "markdown html",
    converter.sourcePath,
    new Error(
      `Markdown ${type} nodes have no HTML rendering; rewrite the content without them`
    )
  );

const referenceSuffix = (node: ImageReference | LinkReference) => {
  if (node.referenceType === "collapsed") {
    return "][]";
  }

  if (node.referenceType === "full") {
    return `][${node.label ?? node.identifier}]`;
  }

  return "]";
};

const linkEntries = (
  url: string,
  title: string | null | undefined
): (readonly [string, HastPropertyValue])[] => [
  ["href", encodeUrl(url)],
  ...(title === null || title === undefined ? [] : [["title", title] as const]),
  ...(isExternalUrl(url) ? [["rel", ["nofollow"]] as const] : []),
];

const imageEntries = (
  url: string,
  alt: string | null | undefined,
  title: string | null | undefined
): (readonly [string, HastPropertyValue])[] => [
  ["src", encodeUrl(url)],
  ["alt", alt ?? undefined],
  ...(title === null || title === undefined ? [] : [["title", title] as const]),
];

const revert = (node: LinkReference, converter: Converter): HastChild[] => {
  const suffix = referenceSuffix(node);
  const contents = converter.children(node);
  const [head] = contents;

  if (head?.type === "text") {
    head.value = `[${head.value}`;
  } else {
    contents.unshift(text("["));
  }

  const tail = contents.at(-1);

  if (tail?.type === "text") {
    tail.value += suffix;
  } else {
    contents.push(text(suffix));
  }

  return contents;
};

const listItemLoose = (node: ListItem) =>
  node.spread ?? node.children.length > 1;

const isParagraph = (node: HastChild | undefined): node is HastElement =>
  node?.type === "element" && node.tagName === "p";

const taskCheckbox = (node: ListItem, result: HastChild[]) => {
  let [head] = result;

  if (!isParagraph(head)) {
    head = element("p", [], []);
    result.unshift(head);
  }

  if (head.children.length > 0) {
    head.children.unshift(text(" "));
  }

  head.children.unshift(
    element(
      "input",
      [
        ["type", "checkbox"],
        ["checked", node.checked ?? false],
        ["disabled", true],
      ],
      []
    )
  );
};

const wrapListItem = (result: readonly HastChild[], loose: boolean) => {
  const wrapped: HastChild[] = [];

  for (const [index, child] of result.entries()) {
    if (loose || index !== 0 || !isParagraph(child)) {
      wrapped.push(text("\n"));
    }

    if (isParagraph(child) && !loose) {
      wrapped.push(...child.children);
    } else {
      wrapped.push(child);
    }
  }

  const last = result.at(-1);

  if (last !== undefined && (loose || !isParagraph(last))) {
    wrapped.push(text("\n"));
  }

  return wrapped;
};

const convertListItem = (
  node: ListItem,
  parent: Parents | undefined,
  converter: Converter
): HastElement => {
  const result = converter.children(node);

  const loose =
    parent?.type === "list"
      ? (parent.spread ?? false) || parent.children.some(listItemLoose)
      : listItemLoose(node);

  const task = Predicate.isBoolean(node.checked);

  if (task) {
    taskCheckbox(node, result);
  }

  return element(
    "li",
    task ? [["className", ["task-list-item"]]] : [],
    wrapListItem(result, loose),
    node.position
  );
};

const tableRows = (node: Table, converter: Converter) => {
  const align = node.align ?? [];

  return node.children.map((row, rowIndex) => {
    const name = rowIndex === 0 ? "th" : "td";
    const width = align.length === 0 ? row.children.length : align.length;

    const cells = Array.from({ length: width }, (_, cellIndex) => {
      const cell = row.children[cellIndex];

      return element(
        name,
        [["align", align[cellIndex] ?? undefined]],
        cell === undefined ? [] : converter.children(cell),
        cell?.position
      );
    });

    return element("tr", [], wrap(cells, true), row.position);
  });
};

const convertTable = (node: Table, converter: Converter): HastElement => {
  const [head, ...body] = tableRows(node, converter);
  const sections: HastChild[] = [];

  if (head !== undefined) {
    sections.push(element("thead", [], wrap([head], true), head.position));
  }

  const [first] = body;
  const start = first?.position?.start;
  const end = body.at(-1)?.position?.end;

  if (first !== undefined) {
    sections.push(
      element(
        "tbody",
        [],
        wrap(body, true),
        start === undefined || end === undefined ? undefined : { end, start }
      )
    );
  }

  return element("table", [], wrap(sections, true), node.position);
};

const listEntries = (
  start: number | null | undefined,
  items: readonly HastChild[]
): (readonly [string, HastPropertyValue])[] => {
  const tasks = items.some(
    (item) =>
      item.type === "element" &&
      Array.isArray(item.properties.className) &&
      item.properties.className.includes("task-list-item")
  );

  return [
    ...(Predicate.isNumber(start) && start !== 1
      ? [["start", start] as const]
      : []),
    ...(tasks ? [["className", ["contains-task-list"]] as const] : []),
  ];
};

const paragraphSource = (
  node: Extract<Nodes, { type: "paragraph" }>,
  converter: Converter
) => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;

  return start === undefined || end === undefined
    ? ""
    : converter.source.slice(start, end);
};

type BlockNode = Extract<
  Nodes,
  {
    type:
      | "blockquote"
      | "code"
      | "definition"
      | "footnoteDefinition"
      | "heading"
      | "html"
      | "list"
      | "listItem"
      | "paragraph"
      | "root"
      | "table"
      | "thematicBreak"
      | "yaml";
  }
>;

type InlineNode = Exclude<Nodes, BlockNode>;

const blockTypes = new Set<string>([
  "blockquote",
  "code",
  "definition",
  "footnoteDefinition",
  "heading",
  "html",
  "list",
  "listItem",
  "paragraph",
  "root",
  "table",
  "thematicBreak",
  "yaml",
]);

const isBlockNode = (node: Nodes): node is BlockNode =>
  blockTypes.has(node.type);

const convertCode = (
  node: Extract<Nodes, { type: "code" }>,
  converter: Converter
): HastChild[] => {
  if (converter.highlight !== undefined) {
    return [raw(converter.highlight(node.value, node.lang), node.position)];
  }

  const lang = languageName.exec(node.lang ?? "")?.[0];

  return [
    element(
      "pre",
      [],
      [
        element(
          "code",
          lang === undefined ? [] : [["className", [`language-${lang}`]]],
          [text(node.value === "" ? "" : `${node.value}\n`)],
          node.position
        ),
      ],
      node.position
    ),
  ];
};

const convertBlock = (
  node: BlockNode,
  parent: Parents | undefined,
  converter: Converter
): HastChild[] => {
  switch (node.type) {
    case "blockquote": {
      return [
        element(
          "blockquote",
          [],
          wrap(converter.children(node), true),
          node.position
        ),
      ];
    }

    case "code": {
      return convertCode(node, converter);
    }

    case "definition":
    case "yaml": {
      return [];
    }

    case "footnoteDefinition": {
      throw unsupported(node.type, converter);
    }

    case "heading": {
      return [
        element(`h${node.depth}`, [], converter.children(node), node.position),
      ];
    }

    case "html": {
      return [raw(node.value, node.position)];
    }

    case "list": {
      const items = converter.children(node);

      return [
        element(
          node.ordered === true ? "ol" : "ul",
          listEntries(node.start, items),
          wrap(items, true),
          node.position
        ),
      ];
    }

    case "listItem": {
      return [convertListItem(node, parent, converter)];
    }

    case "paragraph": {
      const source = paragraphSource(node, converter);

      return htmlBlockStart.test(source)
        ? [raw(source, node.position)]
        : [element("p", [], converter.children(node), node.position)];
    }

    case "root": {
      return wrap(converter.children(node), false);
    }

    case "table": {
      return [convertTable(node, converter)];
    }

    case "thematicBreak": {
      return [element("hr", [], [], node.position)];
    }

    default: {
      return node satisfies never;
    }
  }
};

const convertImageReference = (
  node: ImageReference,
  converter: Converter
): HastChild[] => {
  const definition = converter.definitions.get(node.identifier.toUpperCase());

  if (definition === undefined) {
    return [text(`![${node.alt ?? ""}${referenceSuffix(node)}`)];
  }

  return [
    element(
      "img",
      imageEntries(definition.url, node.alt, definition.title),
      [],
      node.position
    ),
  ];
};

const convertLinkReference = (
  node: LinkReference,
  converter: Converter
): HastChild[] => {
  const definition = converter.definitions.get(node.identifier.toUpperCase());

  if (definition === undefined) {
    return revert(node, converter);
  }

  return [
    element(
      "a",
      linkEntries(definition.url, definition.title),
      converter.children(node),
      node.position
    ),
  ];
};

const convertInline = (node: InlineNode, converter: Converter): HastChild[] => {
  switch (node.type) {
    case "break": {
      return [element("br", [], [], node.position), text("\n")];
    }

    case "delete": {
      return [element("del", [], converter.children(node), node.position)];
    }

    case "emphasis": {
      return [element("em", [], converter.children(node), node.position)];
    }

    case "footnoteReference":
    case "tableCell":
    case "tableRow": {
      throw unsupported(node.type, converter);
    }

    case "image": {
      return [
        element(
          "img",
          imageEntries(node.url, node.alt, node.title),
          [],
          node.position
        ),
      ];
    }

    case "imageReference": {
      return convertImageReference(node, converter);
    }

    case "inlineCode": {
      return [
        element(
          "code",
          [],
          [text(node.value.replaceAll(lineEnding, " "))],
          node.position
        ),
      ];
    }

    case "link": {
      return [
        element(
          "a",
          linkEntries(node.url, node.title),
          converter.children(node),
          node.position
        ),
      ];
    }

    case "linkReference": {
      return convertLinkReference(node, converter);
    }

    case "strong": {
      return [element("strong", [], converter.children(node), node.position)];
    }

    case "text": {
      return [
        text(
          node.value.replaceAll(lineEndingSpaces, "$<ending>"),
          node.position
        ),
      ];
    }

    default: {
      return node satisfies never;
    }
  }
};

const convertNode = (
  node: Nodes,
  parent: Parents | undefined,
  converter: Converter
) =>
  isBlockNode(node)
    ? convertBlock(node, parent, converter)
    : convertInline(node, converter);

const trimAfterBreak = (head: HastChild | undefined) => {
  if (head?.type === "text") {
    head.value = head.value.replace(leadingWhitespace, "");
  } else if (head?.type === "element") {
    const [first] = head.children;

    if (first?.type === "text") {
      first.value = first.value.replace(leadingWhitespace, "");
    }
  }
};

const convertChildren = (
  parent: Parents,
  converter: Converter
): HastChild[] => {
  const values: HastChild[] = [];

  for (const [index, child] of parent.children.entries()) {
    const result = convertNode(child, parent, converter);

    if (index > 0 && parent.children[index - 1]?.type === "break") {
      trimAfterBreak(result[0]);
    }

    values.push(...result);
  }

  return values;
};

const definitionsOf = (root: Root) => {
  const definitions = new Map<string, Definition>();

  visitContentNodes(root, (node) => {
    if (node.type === "definition") {
      const key = node.identifier.toUpperCase();

      if (!definitions.has(key)) {
        definitions.set(key, node);
      }
    }
  });

  return definitions;
};

const createConverter = (
  root: Root,
  source: string,
  options: MarkdownHtmlOptions
): Converter => {
  const converter: Converter = {
    children: (parent) => convertChildren(parent, converter),
    definitions: definitionsOf(root),
    highlight: options.highlight,
    source,
    sourcePath: options.sourcePath,
  };

  return converter;
};

export const markdownHast = (
  source: string,
  options: MarkdownHtmlOptions
): HastRoot => {
  const root = parseContentMarkdown(source, options.sourcePath);

  visitContentNodes(root, (node) => {
    if (node.type === "text") {
      node.value = smartypants(node.value);
    }
  });

  const tree: HastRoot = {
    children: convertNode(
      root,
      undefined,
      createConverter(root, source, options)
    ),
    position: root.position,
    type: "root",
  };

  unified()
    .use(options.rehypePlugins ?? [])
    .runSync(tree satisfies Node);

  return tree;
};

const voidElements = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const capital = /[A-Z]/gu;

const prefixedProperty = /^(?<prefix>aria|data)(?<rest>[A-Z].*)$/u;

const attributeName = (property: string) => {
  if (property === "className") {
    return "class";
  }

  if (property === "htmlFor") {
    return "for";
  }

  const prefixed = prefixedProperty.exec(property)?.groups;

  if (prefixed?.prefix !== undefined && prefixed.rest !== undefined) {
    return `${prefixed.prefix}${prefixed.rest.replaceAll(capital, (letter) => `-${letter.toLowerCase()}`)}`;
  }

  return property.includes("-") ? property : property.toLowerCase();
};

const escapeAttribute = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

const escapeText = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

const serializeAttributes = (
  properties: Readonly<Record<string, HastPropertyValue>>
) =>
  Object.entries(properties)
    .flatMap(([property, value]) => {
      if (value === undefined || value === null || value === false) {
        return [];
      }

      const name = attributeName(property);

      if (value === true) {
        return [` ${name}`];
      }

      const rendered = Array.isArray(value) ? value.join(" ") : String(value);

      return [` ${name}="${escapeAttribute(rendered)}"`];
    })
    .join("");

const serializeNode = (node: HastChild): string => {
  if (node.type === "text") {
    return escapeText(node.value);
  }

  if (node.type === "raw") {
    return node.value;
  }

  const open = `<${node.tagName}${serializeAttributes(node.properties)}>`;

  return voidElements.has(node.tagName)
    ? open
    : `${open}${node.children.map(serializeNode).join("")}</${node.tagName}>`;
};

export const serializeHast = (root: HastRoot) =>
  root.children.map(serializeNode).join("");

interface TemplateElement {
  readonly type: "element";
  readonly name: string;
  readonly attributes: readonly (readonly [string, string])[];
  children: TemplateNode[];
}

interface TemplateText {
  readonly type: "text";
  data: string;
}

type TemplateNode = TemplateElement | TemplateText;

const parseTemplate = (html: string): TemplateNode[] => {
  const root: TemplateElement = {
    attributes: [],
    children: [],
    name: "",
    type: "element",
  };

  const stack: TemplateElement[] = [root];
  let pendingAttributes: [string, string][] = [];

  const current = () => stack.at(-1) ?? root;

  const parser = new Parser(
    {
      onattribute(name, value) {
        pendingAttributes.push([name, value]);
      },
      onclosetag(name) {
        if (current().name === name && stack.length > 1) {
          stack.pop();
        }
      },
      onopentag(name) {
        const node: TemplateElement = {
          attributes: pendingAttributes,
          children: [],
          name,
          type: "element",
        };

        pendingAttributes = [];
        current().children.push(node);

        if (!voidElements.has(name)) {
          stack.push(node);
        }
      },
      ontext(data) {
        const { children } = current();
        const last = children.at(-1);

        if (last?.type === "text") {
          last.data += data;
        } else {
          children.push({ data, type: "text" });
        }
      },
    },
    {
      decodeEntities: false,
      lowerCaseAttributeNames: false,
      lowerCaseTags: false,
      recognizeSelfClosing: true,
    }
  );

  parser.end(html);

  return root.children;
};

const startsWithWhitespace = /^[ \t\r\n]+/u;

const endsWithWhitespace = /[ \t\r\n]+$/u;

const hasContent = /[^ \t\r\n]/u;

const removableSpaceParents = new Set([
  "colgroup",
  "datalist",
  "select",
  "table",
  "tbody",
  "tfoot",
  "thead",
  "tr",
]);

interface CollapseContext {
  readonly parent: string;
  readonly preserve: boolean;
  readonly svg: boolean;
  readonly svgText: boolean;
}

const isBlankText = (node: TemplateNode | undefined) =>
  node?.type === "text" && !hasContent.test(node.data);

const trimFragment = (nodes: readonly TemplateNode[]) => {
  const start = nodes.findIndex((node) => !isBlankText(node));
  const end = nodes.findLastIndex((node) => !isBlankText(node));
  const trimmed = start === -1 ? [] : nodes.slice(start, end + 1);
  const [first] = trimmed;
  const last = trimmed.at(-1);

  if (first?.type === "text") {
    first.data = first.data.replace(startsWithWhitespace, "");
  }

  if (last?.type === "text") {
    last.data = last.data.replace(endsWithWhitespace, "");
  }

  return trimmed;
};

const removesLoneSpaces = (context: CollapseContext) =>
  (context.svg && context.parent !== "text" && !context.svgText) ||
  removableSpaceParents.has(context.parent);

const collapseText = (
  nodes: readonly TemplateNode[],
  context: CollapseContext
) =>
  nodes.flatMap((node): TemplateNode[] => {
    if (node.type !== "text") {
      return [node];
    }

    node.data = node.data
      .replace(startsWithWhitespace, " ")
      .replace(endsWithWhitespace, " ");

    return node.data !== "" &&
      (node.data !== " " || !removesLoneSpaces(context))
      ? [node]
      : [];
  });

const dropPreNewline = (nodes: TemplateNode[], parent: string) => {
  const [head] = nodes;

  return parent === "pre" &&
    head?.type === "text" &&
    (head.data === "\n" || head.data === "\r\n")
    ? nodes.slice(1)
    : nodes;
};

const collapseNodes = (
  nodes: TemplateNode[],
  context: CollapseContext
): TemplateNode[] => {
  const collapsed = dropPreNewline(
    context.preserve ? nodes : collapseText(trimFragment(nodes), context),
    context.parent
  );

  for (const node of collapsed) {
    if (node.type === "element") {
      const svg = context.svg || node.name === "svg";

      node.children = collapseNodes(node.children, {
        parent: node.name,
        preserve:
          context.preserve || node.name === "pre" || node.name === "textarea",
        svg,
        svgText: context.svgText || (svg && node.name === "text"),
      });
    }
  }

  return collapsed;
};

const serializeTemplate = (nodes: readonly TemplateNode[]): string =>
  nodes
    .map((node) => {
      if (node.type === "text") {
        return node.data;
      }

      const attributes = node.attributes
        .map(([name, value]) => ` ${name}="${value.replaceAll('"', "&quot;")}"`)
        .join("");

      const open = `<${node.name}${attributes}>`;

      return voidElements.has(node.name)
        ? open
        : `${open}${serializeTemplate(node.children)}</${node.name}>`;
    })
    .join("");

export const collapseTemplateWhitespace = (html: string) =>
  serializeTemplate(
    collapseNodes(parseTemplate(html), {
      parent: "",
      preserve: false,
      svg: false,
      svgText: false,
    })
  );

export const renderMarkdownHtml = (
  source: string,
  options: MarkdownHtmlOptions
) => collapseTemplateWhitespace(serializeHast(markdownHast(source, options)));
