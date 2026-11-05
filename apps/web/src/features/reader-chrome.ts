import { Button } from "@foldkit/ui";
import * as stylex from "@stylexjs/stylex";
import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import { ratLogoFill, ratLogoPath } from "./rat-logo.js";
import { sectionLinks } from "./reader-panes.js";
import type { SectionListing } from "./reader-panes.js";
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

const newsDot = <Message>(h: HtmlBuilder<Message>) =>
  h.span([h.Class("news-dot"), h.AriaHidden(true)]);

const isNews = (href: string) => href === newsRouter();

const toolbarSection = <Message>(
  h: HtmlBuilder<Message>,
  path: string,
  [href, name]: (typeof siteSections)[number],
  newsTitle: Option.Option<string>
) =>
  Option.match(isNews(href) ? newsTitle : Option.none(), {
    onNone: () => h.li([], [sectionLink(h, path, href, name)]),
    onSome: (title) =>
      h.li(
        [h.Class("news-item")],
        [
          h.a(
            [
              h.Href(href),
              h.AriaDescribedBy("news-latest"),
              ...(isWithinSection(href, path) ? [h.AriaCurrent("page")] : []),
            ],
            [name, newsDot(h)]
          ),
          h.span(
            [h.Class("news-latest"), h.Id("news-latest"), h.Role("tooltip")],
            [
              h.span([h.Class("news-kicker")], ["Latest news"]),
              " ",
              h.span([h.Class("news-headline")], [title]),
            ]
          ),
        ]
      ),
  });

const sheetSection = <Message>(
  h: HtmlBuilder<Message>,
  path: string,
  [href, name]: (typeof siteSections)[number],
  newsTitle: Option.Option<string>
) =>
  Option.match(isNews(href) ? newsTitle : Option.none(), {
    onNone: () => h.li([], [sectionLink(h, path, href, name)]),
    onSome: (title) =>
      h.li(
        [],
        [
          h.a(
            [
              h.Href(href),
              ...(isWithinSection(href, path) ? [h.AriaCurrent("page")] : []),
            ],
            [
              name,
              newsDot(h),
              h.small([h.Class("news-sheet-headline")], [title]),
            ]
          ),
        ]
      ),
  });

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
  open: boolean,
  section: Option.Option<SectionListing>,
  newsTitle: Option.Option<string>
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
          ...siteSections.map((entry) =>
            sheetSection(h, path, entry, newsTitle)
          ),
          h.li([], [h.a([h.Href(agentGuideRouter())], ["agent guide"])]),
        ]
      ),
      ...Option.match(section, {
        onNone: () => [],
        onSome: (listing) => [
          h.p([h.Class("pane-heading")], [listing.title]),
          sectionLinks(h, listing.links),
        ],
      }),
    ]
  );

export const readerToolbar = <Message>(
  h: HtmlBuilder<Message>,
  path: string,
  menu: MenuControl<Message>,
  section: Option.Option<SectionListing>,
  newsTitle: Option.Option<string>
): readonly Html[] => [
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
            siteSections.map((entry) =>
              toolbarSection(h, path, entry, newsTitle)
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
    ]
  ),
  ...(menu.kind === "available"
    ? [menuSheet(h, path, menu.open, section, newsTitle)]
    : []),
];

export const readerFooter = <Message>(
  h: HtmlBuilder<Message>,
  includePrompts: boolean,
  settings: readonly Html[]
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
      ...settings,
    ]
  );
