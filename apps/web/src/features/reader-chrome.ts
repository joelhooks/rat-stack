import * as stylex from "@stylexjs/stylex";
import type { HtmlBuilder } from "foldkit/html";

import type { ReaderModel } from "../client/reader-model.js";
import { readerStyles } from "./reader.stylex.js";

export const readerWorkshop = <Message>(
  workshop: NonNullable<ReaderModel["workshop"]>,
  h: HtmlBuilder<Message>
) =>
  h.aside(
    [h.Class("workshop-callout"), h.AriaLabel(workshop.label)],
    [
      h.span([h.Class("workshop-callout-label")], [workshop.label]),
      h.span([h.Class("workshop-callout-title")], [workshop.line]),
      h.span(
        [h.Class("workshop-callout-action")],
        [
          h.a(
            [h.Class("workshop-callout-apply"), h.Href(workshop.href)],
            [
              workshop.link,
              h.svg(
                [
                  h.Class("icon"),
                  h.Fill("none"),
                  h.Height("16"),
                  h.Width("16"),
                  h.Stroke("currentColor"),
                  h.StrokeWidth("2"),
                  h.ViewBox("0 0 24 24"),
                  h.AriaHidden(true),
                ],
                [
                  h.path([
                    h.D("M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"),
                    h.StrokeLinecap("round"),
                    h.StrokeLinejoin("round"),
                  ]),
                ]
              ),
            ]
          ),
        ]
      ),
    ]
  );

export const readerFooter = <Message>(h: HtmlBuilder<Message>) =>
  h.footer(
    [h.Class(stylex.props(readerStyles.bounded).className ?? "")],
    [
      h.hr([]),
      h.div(
        [h.Class("site-reference")],
        [
          h.section(
            [h.AriaLabel("Explore")],
            [
              h.h2([], ["Explore"]),
              h.ul(
                [],
                [
                  h.li([], [h.a([h.Href("/learn")], ["learn mode"])]),
                  h.li([], [h.a([h.Href("/glossary")], ["glossary"])]),
                  h.li([], [h.a([h.Href("/prompts")], ["prompts"])]),
                  h.li([], [h.a([h.Href("/log")], ["change log"])]),
                  h.li([], [h.a([h.Href("/resources/peers")], ["peers"])]),
                ]
              ),
            ]
          ),
          h.section(
            [h.AriaLabel("Reference")],
            [
              h.h2([], ["Reference"]),
              h.ul(
                [],
                [
                  h.li([], [h.a([h.Href("/llms.txt")], ["agent guide"])]),
                  h.li([], [h.a([h.Href("/openapi.json")], ["API docs"])]),
                  h.li(
                    [],
                    [
                      h.a(
                        [h.Href("https://github.com/joelhooks/rat-stack")],
                        ["source"]
                      ),
                    ]
                  ),
                ]
              ),
            ]
          ),
        ]
      ),
      h.p(
        [],
        [
          "Markdown by default. HTML when you ask for it. ",
          h.a([h.Href("/llms.txt")], ["Agents start here"]),
          ".",
        ]
      ),
    ]
  );
