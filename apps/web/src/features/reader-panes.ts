import { Option } from "effect";
import type { HtmlBuilder } from "foldkit/html";

import type { SectionIndex } from "../client/reader/model.js";
import type { OutlineEntry } from "./reader-outline.js";
import { homeRouter, isWithinSection, siteSections } from "./site-route.js";

export type SectionIndexValue = typeof SectionIndex.Type;

export interface SectionLink {
  readonly current: boolean;
  readonly href: string;
  readonly title: string;
}

export interface SectionListing {
  readonly links: readonly SectionLink[];
  readonly title: string;
}

export const sectionListing = (
  sectionIndex: Option.Option<SectionIndexValue>,
  path: string
): SectionListing =>
  Option.match(sectionIndex, {
    onNone: () => ({
      links: [
        { current: path === homeRouter(), href: homeRouter(), title: "Home" },
        ...siteSections.map(([href, name]) => ({
          current: isWithinSection(href, path),
          href,
          title: name,
        })),
      ],
      title: "Rat Stack",
    }),
    onSome: (index) => ({
      links: index.pages.map((page) => ({
        current: page.path === path,
        href: page.path,
        title: page.title,
      })),
      title: index.title,
    }),
  });

export const sectionLinks = <Message>(
  h: HtmlBuilder<Message>,
  links: readonly SectionLink[]
) =>
  h.ul(
    [],
    links.map((link) =>
      h.li(
        [],
        [
          h.a(
            [
              h.Href(link.href),
              ...(link.current ? [h.AriaCurrent("page")] : []),
            ],
            [link.title]
          ),
        ]
      )
    )
  );

export const sectionIndexPane = <Message>(
  h: HtmlBuilder<Message>,
  listing: SectionListing
) =>
  h.nav(
    [h.Class("section-index"), h.AriaLabel("Section pages")],
    [
      h.p([h.Class("pane-heading")], [listing.title]),
      sectionLinks(h, listing.links),
    ]
  );

export const outlinePane = <Message>(
  h: HtmlBuilder<Message>,
  entries: readonly OutlineEntry[],
  active: Option.Option<string>
) =>
  h.nav(
    [h.Class("page-outline"), h.AriaLabel("On this page")],
    entries.length === 0
      ? []
      : [
          h.p([h.Class("pane-heading")], ["On this page"]),
          h.ul(
            [],
            entries.map((entry) =>
              h.keyed("li")(
                entry.id,
                [h.Class(entry.level === 3 ? "outline-sub" : "outline-top")],
                [
                  h.a(
                    [
                      h.Href(`#${entry.id}`),
                      ...(Option.contains(active, entry.id)
                        ? [h.AriaCurrent("location")]
                        : []),
                    ],
                    [entry.text]
                  ),
                ]
              )
            )
          ),
        ]
  );
