import type { Html, HtmlBuilder } from "foldkit/html";

import { ReaderNode } from "../client/reader-node.js";
import type { ReaderNodeValue } from "../client/reader-node.js";

export const renderReaderNode = <Message>(
  node: ReaderNodeValue,
  h: HtmlBuilder<Message>,
  copyControl: (id: string, primary: boolean) => Html
): Html | string =>
  ReaderNode.$match(node, {
    CopyPrompt: ({ id, primary }) => copyControl(id, primary),
    Element: ({ attributes, children, tag }) =>
      h[tag](
        attributes.map(({ name, value }) => h.Attribute(name, value)),
        children.map((child) => renderReaderNode(child, h, copyControl))
      ),
    Text: ({ value }) => value,
  });
