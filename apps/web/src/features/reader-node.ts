import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import { ReaderNode } from "../client/reader-node.js";
import type { ReaderNodeValue } from "../client/reader-node.js";
import { routeOfHref } from "./local-graph.js";

export const readerPeekId = "reader-peek";

export interface LinkMarks {
  readonly described: Option.Option<string>;
  readonly lit: Option.Option<string>;
}

export const noLinkMarks: LinkMarks = {
  described: Option.none(),
  lit: Option.none(),
};

interface ReaderAttribute {
  readonly name: string;
  readonly value: string;
}

const internalRoute = (
  tag: string,
  attributes: readonly ReaderAttribute[]
): Option.Option<string> =>
  tag === "a"
    ? Option.map(
        Option.fromNullishOr(
          attributes.find(
            ({ name, value }) => name === "href" && value.startsWith("/")
          )
        ),
        ({ value }) => routeOfHref(value)
      )
    : Option.none();

const markAttributes = <Message>(
  h: HtmlBuilder<Message>,
  route: Option.Option<string>,
  marks: LinkMarks
) => [
  ...(Option.isSome(route) && Option.contains(marks.lit, route.value)
    ? [h.DataAttribute("graph-lit", "")]
    : []),
  ...(Option.isSome(route) && Option.contains(marks.described, route.value)
    ? [h.AriaDescribedBy(readerPeekId)]
    : []),
];

export const renderReaderNode = <Message>(
  node: ReaderNodeValue,
  h: HtmlBuilder<Message>,
  copyControl: (id: string, primary: boolean) => Html,
  marks: LinkMarks
): Html | string =>
  ReaderNode.$match(node, {
    CopyPrompt: ({ id, primary }) => copyControl(id, primary),
    Element: ({ attributes, children, tag }) =>
      h[tag](
        [
          ...attributes.map(({ name, value }) => h.Attribute(name, value)),
          ...markAttributes(h, internalRoute(tag, attributes), marks),
        ],
        children.map((child) =>
          renderReaderNode(
            child,
            h,
            copyControl,
            tag === "sup" ? noLinkMarks : marks
          )
        )
      ),
    Text: ({ value }) => value,
  });
