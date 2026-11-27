import type { View } from "@effect/ui";
import type { Html } from "@effect/ui/html";
import * as stylex from "@stylexjs/stylex";
import { Option } from "effect";

import type {
  ReaderMessage,
  ReaderPageProps,
  ReaderState,
} from "../../client/reader-effect-ui/model.js";
import { ReaderNode } from "../../client/reader-node.js";
import type { ReaderNodeValue } from "../../client/reader-node.js";
import { readerStyles } from "../reader.stylex.js";
import {
  agentPointer,
  breadcrumbView,
  newsCallout,
  siteFooter,
  siteHeader,
} from "./chrome.js";
import { copyControl } from "./copy.js";
import { bibliographyView, referencesView } from "./references.js";

type ReaderHtml = Html.H<typeof ReaderMessage.Type>;

type ReaderInput = View.Input<typeof ReaderMessage.Type>;

const renderNode = (
  h: ReaderHtml,
  node: ReaderNodeValue,
  props: ReaderPageProps,
  model: ReaderState
): ReaderInput =>
  ReaderNode.$match(node, {
    CopyPrompt: ({ id, primary }) => copyControl(h, props, model, id, primary),
    Element: ({ attributes, children, tag }) =>
      h
        .el(tag)
        .attrs(
          Object.fromEntries(attributes.map(({ name, value }) => [name, value]))
        )
        .children(
          ...children.map((child) => renderNode(h, child, props, model))
        ),
    Text: ({ value }) => value,
  });

export const view = (
  h: ReaderHtml,
  props: ReaderPageProps,
  model: ReaderState
) =>
  h.div.class(stylex.props(readerStyles.shell).className ?? "").children(
    siteHeader(h),
    h.main.attr("data-path", props.page.path).children(
      agentPointer(h, props.origin),
      ...Option.match(props.newsTitle, {
        onNone: () => [],
        onSome: (title) => [newsCallout(h, title)],
      }),
      ...breadcrumbView(h, props),
      ...props.nodes.map((node) => renderNode(h, node, props, model)),
      ...bibliographyView(h, props.bibliography),
      ...referencesView(h, props)
    ),
    siteFooter(h, props.page)
  );
