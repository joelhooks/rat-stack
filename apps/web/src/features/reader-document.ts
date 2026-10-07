import type { Html, HtmlBuilder } from "foldkit/html";

import { ReaderBlock, ReaderInline } from "../client/reader-document.js";
import type {
  ReaderBlockValue,
  ReaderInlineValue,
} from "../client/reader-document.js";
import { readerParagraph } from "./reader-paragraph.js";

export type SnippetReference = Extract<
  ReaderBlockValue,
  { readonly _tag: "Snippet" }
>;

export interface ReaderBlockRenderers {
  readonly anchors: readonly { readonly id: string; readonly text: string }[];
  readonly inboundCounts: Readonly<Record<string, number>>;
  readonly pagePath: string;
  readonly codeFence: (value: string) => Html;
  readonly copyPrompt: (id: string) => Html;
  readonly snippet: (reference: SnippetReference) => Html;
}

export const renderReaderInline = <Message>(
  inline: ReaderInlineValue,
  h: HtmlBuilder<Message>,
  counts: Readonly<Record<string, number>> = {},
  pagePath = ""
): Html | string =>
  ReaderInline.$match(inline, {
    Code: ({ value }) => h.code([], [value]),
    Emphasis: ({ content }) =>
      h.em(
        [],
        content.map((child) => renderReaderInline(child, h, counts, pagePath))
      ),
    Link: ({ href, value }) => {
      const count = counts[href] ?? 0;
      const anchor = h.a([h.Href(href)], [value]);

      if (
        href === pagePath ||
        !/^\/(?:lore|systems|skills)\//u.test(href) ||
        count < 2
      ) {
        return anchor;
      }

      return h.span(
        [],
        [
          anchor,
          h.sup(
            [h.Class("inbound-count")],
            [
              h.a(
                [
                  h.Href(`${href}#linked-from`),
                  h.AriaLabel(`${count} pages link here`),
                ],
                [String(count)]
              ),
            ]
          ),
        ]
      );
    },
    Strong: ({ content }) =>
      h.strong(
        [],
        content.map((child) => renderReaderInline(child, h, counts, pagePath))
      ),
    Text: ({ value }) => value.replaceAll(/(?<=\p{L})\u0027(?=\p{L})/gu, "’"),
  });

export const renderReaderBlock = <Message>(
  block: ReaderBlockValue,
  h: HtmlBuilder<Message>,
  renderers: ReaderBlockRenderers
): Html =>
  ReaderBlock.match<Html>(block, {
    CodeFence: ({ value }) => renderers.codeFence(value),
    CopyPrompt: ({ id }) => renderers.copyPrompt(id),
    Diagram: ({ alt, value }) =>
      h.figure(
        [h.Role("img"), h.AriaLabel(alt)],
        [renderers.codeFence(value), h.figcaption([], [alt])]
      ),
    Heading: ({ id, level, title }) => {
      if (level === 3) {
        return h.h3([h.Id(id)], [title]);
      }

      return level === 4
        ? h.h4([h.Id(id)], [title])
        : h.h2([h.Id(id)], [title]);
    },
    List: ({ items }) =>
      h.ul(
        [],
        items.map((item) =>
          readerParagraph("li", item, renderers.anchors, h, (inline) =>
            renderReaderInline(
              inline,
              h,
              renderers.inboundCounts,
              renderers.pagePath
            )
          )
        )
      ),
    Paragraph: ({ content }) =>
      readerParagraph("p", content, renderers.anchors, h, (inline) =>
        renderReaderInline(
          inline,
          h,
          renderers.inboundCounts,
          renderers.pagePath
        )
      ),
    PromptText: ({ value }) => h.pre([h.Class("prompt")], [value]),
    Snippet: renderers.snippet,
  });
