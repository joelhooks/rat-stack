import type { Html, HtmlBuilder } from "foldkit/html";

import { ReaderInline } from "../client/reader-document.js";
import type {
  ReaderBlockValue,
  ReaderInlineValue,
} from "../client/reader-document.js";

const inlineText = (inline: ReaderInlineValue): string =>
  ReaderInline.$match(inline, {
    Code: ({ value }) => value,
    Emphasis: ({ content }) => content.map(inlineText).join(""),
    Link: ({ value }) => value,
    Strong: ({ content }) => content.map(inlineText).join(""),
    Text: ({ value }) => value,
  });

export const readerTable = <Message>(
  table: Extract<ReaderBlockValue, { readonly _tag: "Table" }>,
  renderInline: (inline: ReaderInlineValue) => Html | string,
  h: HtmlBuilder<Message>
): Html => {
  const labels = table.headers.map(
    (cell, index) =>
      cell.map(inlineText).join("").trim() || `Column ${index + 1}`
  );

  const alignment = (column: number) => {
    const align = table.align[column];

    return align === null || align === undefined
      ? []
      : [h.Attribute("align", align)];
  };

  return h.div(
    [
      h.Class(
        table.headers.length >= 6 ? "table-wrapper table-wide" : "table-wrapper"
      ),
      h.Role("region"),
      h.AriaLabel(table.label),
      h.Tabindex(0),
    ],
    [
      h.table(
        [h.Role("table")],
        [
          h.thead(
            [h.Role("rowgroup")],
            [
              h.tr(
                [h.Role("row")],
                table.headers.map((cell, column) =>
                  h.th(
                    [
                      h.Role("columnheader"),
                      h.Scope("col"),
                      ...alignment(column),
                    ],
                    cell.map(renderInline)
                  )
                )
              ),
            ]
          ),
          h.tbody(
            [h.Role("rowgroup")],
            table.rows.map((row) =>
              h.tr(
                [h.Role("row")],
                row.map((cell, column) =>
                  h.td(
                    [
                      h.Role("cell"),
                      h.Attribute(
                        "data-label",
                        labels[column] ?? `Column ${column + 1}`
                      ),
                      ...alignment(column),
                    ],
                    cell.map(renderInline)
                  )
                )
              )
            )
          ),
        ]
      ),
    ]
  );
};
