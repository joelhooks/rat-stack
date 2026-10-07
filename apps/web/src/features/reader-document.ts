import type { Html, HtmlBuilder } from "foldkit/html";

import { ReaderBlock, ReaderInline } from "../client/reader-document.js";
import type {
  ReaderBlockValue,
  ReaderInlineValue,
} from "../client/reader-document.js";

export type SnippetReference = Extract<
  ReaderBlockValue,
  { readonly _tag: "Snippet" }
>;

export interface ReaderBlockRenderers {
  readonly codeFence: (value: string) => Html;
  readonly copyPrompt: (id: string) => Html;
  readonly snippet: (reference: SnippetReference) => Html;
}

export const renderReaderInline = <Message>(
  inline: ReaderInlineValue,
  h: HtmlBuilder<Message>
): Html | string =>
  ReaderInline.$match(inline, {
    Code: ({ value }) => h.code([], [value]),
    Emphasis: ({ content }) =>
      h.em(
        [],
        content.map((child) => renderReaderInline(child, h))
      ),
    Link: ({ href, value }) => h.a([h.Href(href)], [value]),
    Strong: ({ content }) =>
      h.strong(
        [],
        content.map((child) => renderReaderInline(child, h))
      ),
    Text: ({ value }) => value,
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
          h.li(
            [],
            item.map((inline) => renderReaderInline(inline, h))
          )
        )
      ),
    Paragraph: ({ content }) =>
      h.p(
        [],
        content.map((inline) => renderReaderInline(inline, h))
      ),
    Snippet: renderers.snippet,
  });
