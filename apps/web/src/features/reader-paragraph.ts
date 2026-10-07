import type { Html, HtmlBuilder } from "foldkit/html";

import { ReaderInline } from "../client/reader-document.js";
import type { ReaderInlineValue } from "../client/reader-document.js";

const inlineText = (inline: ReaderInlineValue): string =>
  ReaderInline.$match(inline, {
    Code: ({ value }) => value,
    Emphasis: ({ content }) => content.map(inlineText).join(""),
    Link: ({ value }) => value,
    Strong: ({ content }) => content.map(inlineText).join(""),
    Text: ({ value }) => value,
  });

export const readerParagraph = <Message>(
  tag: "p" | "li",
  content: readonly ReaderInlineValue[],
  anchors: readonly { readonly id: string; readonly text: string }[],
  h: HtmlBuilder<Message>,
  renderInline: (inline: ReaderInlineValue) => Html | string
): Html => {
  const text = content
    .map(inlineText)
    .join("")
    .normalize("NFC")
    .replaceAll(/\s+/gu, " ")
    .trim();

  const id = anchors.find(
    (anchor) => anchor.id.startsWith(`${tag}-`) && anchor.text === text
  )?.id;

  return h[tag](id === undefined ? [] : [h.Id(id)], [
    ...content.map(renderInline),
    ...(id === undefined
      ? []
      : [
          h.a(
            [
              h.Href(`#${id}`),
              h.Class("paragraph-link"),
              h.AriaLabel("Link to this paragraph"),
            ],
            ["¶"]
          ),
        ]),
  ]);
};
