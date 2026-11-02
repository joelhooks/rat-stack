import * as stylex from "@stylexjs/stylex";
import type { HtmlBuilder } from "foldkit/html";

import { readerStyles } from "./reader.stylex.js";
import {
  agentGuideRouter,
  apiDocsRouter,
  changeLogRouter,
  glossaryRouter,
  learnRouter,
  newsRouter,
  peersRouter,
  promptsRouter,
} from "./site-route.js";

export const readerNewsCallout = <Message>(
  title: string,
  h: HtmlBuilder<Message>
) =>
  h.aside(
    [h.Class("news-callout"), h.AriaLabel("New on /news")],
    [h.span([], ["New on /news:"]), " ", h.a([h.Href(newsRouter())], [title])]
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
