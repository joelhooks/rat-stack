import type { Html } from "@effect/ui/html";
import * as stylex from "@stylexjs/stylex";
import { Option } from "effect";

import type {
  ReaderMessage,
  ReaderPageProps,
} from "../../client/reader-effect-ui/model.js";
import { readerStyles } from "../reader.stylex.js";

type ReaderHtml = Html.H<typeof ReaderMessage.Type>;

const siteSections = [
  ["/skills", "skills"],
  ["/lore", "lore"],
  ["/systems", "systems"],
  ["/news", "news"],
  ["/all-stars", "all stars"],
  ["/glossary", "glossary"],
  ["/search", "search"],
] as const;

const sectionIndexes: ReadonlySet<string> = new Set([
  "/",
  "/lore",
  "/glossary",
  "/systems",
  "/skills",
  "/search",
  "/tokenmaxx",
]);

const inSection = (section: string, path: string) =>
  path === section || path.startsWith(`${section}/`);

const link = (h: ReaderHtml, href: string, label: string) =>
  h.a.attr("href", href).children(label);

export const siteHeader = (h: ReaderHtml) =>
  h.header
    .class(
      stylex.props(readerStyles.bounded, readerStyles.header).className ?? ""
    )
    .children(
      h.nav
        .attrs({ "aria-label": "Primary navigation", class: "site-nav" })
        .children(
          h.a
            .attrs({ class: "brand", href: "/" })
            .children(h.strong("🐀 Rat Stack")),
          h.div
            .class("site-links")
            .children(
              h.ul(
                ...siteSections.map(([href, label]) =>
                  h.li(link(h, href, label))
                )
              ),
              h.ul(h.li(link(h, "/llms.txt", "agent guide")))
            )
        )
    );

export const agentPointer = (h: ReaderHtml, origin: string) =>
  h.p
    .attrs({ "aria-hidden": "true", class: "agent-pointer visually-hidden" })
    .children(
      "For agents: start with the ",
      h.a
        .attrs({ href: `${origin}/llms.txt`, tabindex: "-1" })
        .children("agent guide"),
      ". Every page is Markdown by default; add Accept: text/html for HTML."
    );

export const newsCallout = (h: ReaderHtml, title: string) =>
  h.aside
    .attrs({ "aria-label": "New on /news", class: "news-callout" })
    .children(h.span("New on /news:"), " ", link(h, "/news", title));

const defaultBreadcrumb = (path: string, name: string) => {
  if (inSection("/prompts", path)) {
    return { href: "/prompts", label: "prompts", name };
  }

  return path.startsWith("/lore/")
    ? { href: "/lore", label: "lore", name }
    : { href: "/", label: "source files", name };
};

export const breadcrumbView = (h: ReaderHtml, props: ReaderPageProps) => {
  const { path } = props.page;

  if (sectionIndexes.has(path)) {
    return [];
  }

  const { href, label, name } = Option.getOrElse(props.breadcrumb, () =>
    defaultBreadcrumb(path, props.heading)
  );

  return [
    h.nav
      .attrs({ "aria-label": "Breadcrumb", class: "breadcrumb" })
      .children(link(h, href, label), ` / ${name}`),
  ];
};

export const siteFooter = (
  h: ReaderHtml,
  { path, status }: ReaderPageProps["page"]
) => {
  const includePrompts =
    status < 400 &&
    (path === "/" ||
      path === "/learn" ||
      inSection("/lore", path) ||
      inSection("/prompts", path));

  return h.footer
    .class(stylex.props(readerStyles.bounded).className ?? "")
    .children(
      h.hr,
      h.div
        .class("site-reference")
        .children(
          h.section
            .attr("aria-label", "Explore")
            .children(
              h.h2("Explore"),
              h.ul(
                h.li(link(h, "/learn", "learn mode")),
                h.li(link(h, "/glossary", "glossary")),
                ...(includePrompts
                  ? [h.li(link(h, "/prompts", "prompts"))]
                  : []),
                h.li(link(h, "/log", "change log")),
                h.li(link(h, "/resources/peers", "peers"))
              )
            ),
          h.section
            .attr("aria-label", "Reference")
            .children(
              h.h2("Reference"),
              h.ul(
                h.li(link(h, "/llms.txt", "agent guide")),
                h.li(link(h, "/openapi.json", "API docs")),
                h.li(
                  link(h, "https://github.com/joelhooks/rat-stack", "source")
                )
              )
            )
        ),
      h.p(
        "Markdown by default. HTML when you ask for it. ",
        link(h, "/llms.txt", "Agents start here"),
        "."
      )
    );
};
