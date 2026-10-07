import * as stylex from "@stylexjs/stylex";
import type { HtmlBuilder } from "foldkit/html";

import type { ReaderModel } from "../client/reader-model.js";
import { readerStyles } from "./reader.stylex.js";

export const readerWorkshop = <Message>(
  model: ReaderModel,
  h: HtmlBuilder<Message>
) =>
  h.aside(
    [h.Class("workshop-callout"), h.AriaLabel(model.workshop.label)],
    [
      h.span([h.Class("workshop-callout-label")], [model.workshop.label]),
      h.span([h.Class("workshop-callout-title")], [model.workshop.line]),
      h.span(
        [h.Class("workshop-callout-action")],
        [
          h.a(
            [h.Class("workshop-callout-apply"), h.Href(model.workshop.href)],
            [
              model.workshop.link,
              h.span([
                h.AriaHidden(true),
                h.InnerHTML(
                  '<svg class="icon" fill="none" height="16" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16"><path d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
                ),
              ]),
            ]
          ),
          h.small([h.Class("workshop-callout-note")], [model.workshop.note]),
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
