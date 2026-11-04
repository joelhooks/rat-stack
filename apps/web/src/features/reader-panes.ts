import { Option } from "effect";
import type { HtmlBuilder } from "foldkit/html";

import type { SectionIndex } from "../client/reader/model.js";
import type { OutlineEntry, OutlineGroup } from "./reader-outline.js";
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

const outlineLink = <Message>(
  h: HtmlBuilder<Message>,
  entry: OutlineEntry,
  active: ReadonlySet<string>,
  onJump: Option.Option<Message>
) =>
  h.a(
    [
      h.Href(`#${entry.id}`),
      ...(active.has(entry.id) ? [h.AriaCurrent("location")] : []),
      ...Option.match(onJump, {
        onNone: () => [],
        onSome: (message) => [h.OnClick(message)],
      }),
    ],
    [entry.text]
  );

const outlineList = <Message>(
  h: HtmlBuilder<Message>,
  groups: readonly OutlineGroup[],
  active: ReadonlySet<string>,
  onJump: Option.Option<Message>
) =>
  h.ul(
    [],
    groups.map((group) =>
      h.keyed("li")(
        group.entry.id,
        [h.Class(group.entry.level === 3 ? "outline-sub" : "outline-top")],
        [
          outlineLink(h, group.entry, active, onJump),
          ...(group.children.length === 0
            ? []
            : [
                h.ul(
                  [],
                  group.children.map((child) =>
                    h.keyed("li")(
                      child.id,
                      [h.Class("outline-sub")],
                      [outlineLink(h, child, active, onJump)]
                    )
                  )
                ),
              ]),
        ]
      )
    )
  );

export const outlinePane = <Message>(
  h: HtmlBuilder<Message>,
  groups: readonly OutlineGroup[],
  active: ReadonlySet<string>
) =>
  h.nav(
    [h.Class("page-outline"), h.AriaLabel("On this page")],
    groups.length === 0
      ? []
      : [
          h.p([h.Class("pane-heading")], ["On this page"]),
          outlineList(h, groups, active, Option.none()),
        ]
  );

export interface PhoneOutlineControl<Message> {
  readonly onJump: Message;
  readonly onToggle: (open: boolean) => Message;
  readonly open: boolean;
}

export const phoneOutline = <Message>(
  h: HtmlBuilder<Message>,
  groups: readonly OutlineGroup[],
  control: PhoneOutlineControl<Message>
) =>
  groups.length === 0
    ? []
    : [
        h.details(
          [
            h.Class("phone-outline"),
            h.Open(control.open),
            h.OnToggle(control.onToggle),
          ],
          [
            h.summary([], ["On this page"]),
            outlineList(h, groups, new Set(), Option.some(control.onJump)),
          ]
        ),
      ];
