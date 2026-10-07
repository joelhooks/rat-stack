import { Effect, Predicate, Schema } from "effect";
import { DomUtils, ElementType, parseDocument } from "htmlparser2";

import {
  ReaderAttributeName,
  ReaderBreadcrumb,
  ReaderNode,
  ReaderNodeSchema,
  ReaderTag,
} from "../../web/src/client/reader-node.js";
import type { ReaderNodeValue } from "../../web/src/client/reader-node.js";
import { ReaderInputError } from "./reader-input-error.ts";

export const readerWorkshopCount = (html: string) =>
  DomUtils.getElementsByTagName("aside", parseDocument(html).children).filter(
    (element) =>
      element.attribs.class?.split(/\s+/u).includes("workshop-callout") === true
  ).length;

const ReaderBody = Schema.Struct({
  breadcrumb: Schema.optional(ReaderBreadcrumb),
  heading: Schema.String,
  nodes: Schema.Array(ReaderNodeSchema),
});

export const compileReaderNodes = (
  nodes: ReturnType<typeof parseDocument>["children"],
  sourcePath: string
) => {
  const failures: string[] = [];

  const convert = (node: (typeof nodes)[number]): ReaderNodeValue => {
    if (node.type === ElementType.Text) {
      return ReaderNode.Text({ value: node.data });
    }

    if (node.type === ElementType.Comment) {
      return ReaderNode.Text({ value: "" });
    }

    if (node.type !== ElementType.Tag) {
      failures.push(
        `Unsupported node ${node.type}; add an explicit reader projection`
      );

      return ReaderNode.Text({ value: "" });
    }

    const children = node.children.map(convert);

    const attributes = Object.entries(node.attribs)
      .map(([name, value]) => {
        if (!Schema.is(ReaderAttributeName)(name)) {
          failures.push(
            `Unsupported attribute ${name} on <${node.name}>; add an explicit reader projection`
          );

          return null;
        }

        if (
          (name === "href" || name === "src") &&
          /^[a-z][a-z\d+.-]*:/iu.test(value) &&
          !/^(?:https?:\/\/|mailto:)/u.test(value)
        ) {
          failures.push(
            `Unsupported ${name} URL ${value}; use a public HTTP, relative, fragment or mailto link`
          );
        }

        return { name, value };
      })
      .filter(Predicate.isNotNull);

    if (!Schema.is(ReaderTag)(node.name)) {
      failures.push(
        `Unsupported element <${node.name}>; add an explicit reader projection`
      );

      return ReaderNode.Text({ value: "" });
    }

    return ReaderNode.Element({ attributes, children, tag: node.name });
  };

  const converted = nodes.map(convert);

  if (failures.length > 0) {
    throw new ReaderInputError({ message: failures.join("\n"), sourcePath });
  }

  return Schema.decodeSync(Schema.Array(ReaderNodeSchema))(converted);
};

const readBody = (html: string, sourcePath: string) => {
  const document = parseDocument(html);
  const mains = DomUtils.getElementsByTagName("main", document.children);
  const main = mains.at(0);

  if (main === undefined || mains.length !== 1) {
    throw new Error("Reader document requires exactly one main element");
  }

  const headingIndex = main.children.findIndex(
    (node) => node.type === ElementType.Tag && node.name === "h1"
  );

  const heading = main.children.at(headingIndex);

  if (
    headingIndex === -1 ||
    heading === undefined ||
    heading.type !== ElementType.Tag
  ) {
    throw new Error("Reader document requires a direct h1 child in main");
  }

  const prefixFailures = main.children.slice(0, headingIndex).filter((node) => {
    if (node.type === ElementType.Comment) {
      return false;
    }

    if (node.type === ElementType.Text) {
      return node.data.trim() !== "";
    }

    if (node.type !== ElementType.Tag) {
      return true;
    }

    const classes = (node.attribs.class ?? "").split(/\s+/u);

    return !(
      (node.name === "p" && classes.includes("agent-pointer")) ||
      (node.name === "aside" && classes.includes("workshop-callout")) ||
      (node.name === "nav" && node.attribs["aria-label"] === "Breadcrumb")
    );
  });

  if (prefixFailures.length > 0) {
    throw new ReaderInputError({
      message:
        "Human content precedes the heading; put the document h1 before its body to preserve every node",
      sourcePath,
    });
  }

  const breadcrumbs = DomUtils.getElementsByTagName(
    "nav",
    main.children
  ).filter((node) => node.attribs["aria-label"] === "Breadcrumb");

  const breadcrumb = breadcrumbs.at(0);

  const link =
    breadcrumb === undefined
      ? undefined
      : DomUtils.getElementsByTagName("a", breadcrumb.children).at(0);

  return Schema.decodeUnknownSync(ReaderBody)({
    breadcrumb:
      breadcrumb === undefined || link === undefined
        ? undefined
        : {
            href: link.attribs.href,
            label: DomUtils.textContent(link),
            name: DomUtils.textContent(breadcrumb)
              .slice(DomUtils.textContent(link).length)
              .replace(/^\s*\/\s*/u, "")
              .trim(),
          },
    heading: DomUtils.textContent(heading),
    nodes: compileReaderNodes(main.children.slice(headingIndex), sourcePath),
  });
};

export const compileReaderBody = Effect.fn("compileReaderBody")(
  function* compileReaderBody(html: string, sourcePath: string) {
    return yield* Effect.try({
      catch: (cause) =>
        new ReaderInputError({
          cause,
          message: Schema.is(ReaderInputError)(cause)
            ? cause.message
            : "Cannot project the reader body; repair the generated document structure",
          sourcePath,
        }),
      try: () => readBody(html, sourcePath),
    });
  }
);

export const compileReaderBodies = Effect.fn("compileReaderBodies")(
  function* compileReaderBodies(
    pages: readonly { readonly html: string; readonly sourcePath: string }[]
  ) {
    return yield* Effect.validate(pages, (page) =>
      compileReaderBody(page.html, page.sourcePath)
    );
  }
);
