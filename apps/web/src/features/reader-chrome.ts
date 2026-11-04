import { Button } from "@foldkit/ui";
import * as stylex from "@stylexjs/stylex";
import type { HtmlBuilder } from "foldkit/html";

import { ratLogoFill, ratLogoPath } from "./rat-logo.js";
import { readerStyles } from "./reader.stylex.js";
import {
  agentGuideRouter,
  apiDocsRouter,
  changeLogRouter,
  glossaryRouter,
  homeRouter,
  isWithinSection,
  learnRouter,
  newsRouter,
  peersRouter,
  promptsRouter,
  siteSections,
} from "./site-route.js";

const ratLogo = <Message>(h: HtmlBuilder<Message>) =>
  h.svg(
    [
      h.Class("logo"),
      h.ViewBox("0 0 65 78"),
      h.Fill(ratLogoFill),
      h.Attribute("shape-rendering", "crispEdges"),
      h.AriaHidden(true),
      h.Attribute("focusable", "false"),
    ],
    [h.path([h.D(ratLogoPath)])]
  );

const sectionLink = <Message>(
  h: HtmlBuilder<Message>,
  path: string,
  href: string,
  name: string
) =>
  h.a(
    [
      h.Href(href),
      ...(isWithinSection(href, path) ? [h.AriaCurrent("page")] : []),
    ],
    [name]
  );

export type MenuControl<Message> =
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "available";
      readonly open: boolean;
      readonly onToggle: Message;
    };

const menuButtonContent = <Message>(h: HtmlBuilder<Message>, open: boolean) => [
  h.svg(
    [
      h.ViewBox("0 0 16 16"),
      h.Width("16"),
      h.Height("16"),
      h.AriaHidden(true),
      h.Attribute("focusable", "false"),
    ],
    [
      h.path([
        h.D(open ? "M3.5 3.5l9 9M12.5 3.5l-9 9" : "M2 5h12M2 11h12"),
        h.Stroke("currentColor"),
        h.StrokeWidth("1.6"),
        h.StrokeLinecap("round"),
      ]),
    ]
  ),
  h.span([], [open ? "Close" : "Menu"]),
];

const menuButton = <Message>(
  h: HtmlBuilder<Message>,
  open: boolean,
  onToggle: Message
) =>
  Button.view(
    {
      onClick: onToggle,
      toView: ({ button }) =>
        h.button(
          [
            ...button,
            h.Class("menu-button"),
            h.AriaExpanded(open),
            h.AriaControls("site-menu"),
          ],
          menuButtonContent(h, open)
        ),
    },
    h
  );

const menuSheet = <Message>(
  h: HtmlBuilder<Message>,
  path: string,
  open: boolean
) =>
  h.nav(
    [
      h.Id("site-menu"),
      h.Class("menu-sheet"),
      h.AriaLabel("Site menu"),
      h.Hidden(!open),
    ],
    [
      h.ul(
        [],
        [
          ...siteSections.map(([href, name]) =>
            h.li([], [sectionLink(h, path, href, name)])
          ),
          h.li([], [h.a([h.Href(agentGuideRouter())], ["agent guide"])]),
        ]
      ),
    ]
  );

export const readerToolbar = <Message>(
  h: HtmlBuilder<Message>,
  path: string,
  menu: MenuControl<Message>
) =>
  h.header(
    [h.Class("toolbar")],
    [
      h.nav(
        [h.AriaLabel("Primary navigation"), h.Class("site-nav")],
        [
          h.a(
            [h.Class("brand"), h.Href(homeRouter())],
            [ratLogo(h), h.strong([], ["Rat Stack"])]
          ),
          h.ul(
            [h.Class("site-sections")],
            siteSections.map(([href, name]) =>
              h.li([], [sectionLink(h, path, href, name)])
            )
          ),
          h.a(
            [h.Class("agent-guide"), h.Href(agentGuideRouter())],
            ["agent guide"]
          ),
          ...(menu.kind === "available"
            ? [menuButton(h, menu.open, menu.onToggle)]
            : []),
        ]
      ),
      ...(menu.kind === "available" ? [menuSheet(h, path, menu.open)] : []),
    ]
  );

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
      h.p([h.Class("colophon")], ["Ratstack or die 🐀💀"]),
    ]
  );
