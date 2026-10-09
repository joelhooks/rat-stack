import * as stylex from "@stylexjs/stylex";
import type { HtmlBuilder } from "foldkit/html";

import type { ReaderModel } from "../client/reader-model.js";
import { readerStyles } from "./reader.stylex.js";
import {
  agentGuideRouter,
  apiDocsRouter,
  changeLogRouter,
  glossaryRouter,
  learnRouter,
  peersRouter,
  promptsRouter,
} from "./site-route.js";

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

export const readerFooter = <Message>(
  h: HtmlBuilder<Message>,
  includePrompts = true
) =>
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
                  h.li([], [h.a([h.Href(learnRouter())], ["learn mode"])]),
                  h.li([], [h.a([h.Href(glossaryRouter())], ["glossary"])]),
                  ...(includePrompts
                    ? [h.li([], [h.a([h.Href(promptsRouter())], ["prompts"])])]
                    : []),
                  h.li([], [h.a([h.Href(changeLogRouter())], ["change log"])]),
                  h.li([], [h.a([h.Href(peersRouter())], ["peers"])]),
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
                  h.li(
                    [],
                    [h.a([h.Href(agentGuideRouter())], ["agent guide"])]
                  ),
                  h.li([], [h.a([h.Href(apiDocsRouter())], ["API docs"])]),
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
          h.a([h.Href(agentGuideRouter())], ["Agents start here"]),
          ".",
        ]
      ),
    ]
  );
