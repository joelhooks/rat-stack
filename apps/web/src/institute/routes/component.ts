import { Html } from "@effect/ui/html";
import { Schema } from "effect";

import { mitNotice, narrationCredit } from "./credits.js";
import {
  InstitutePageProps,
  instituteDescription,
  institutePlayerId,
  instituteTitle,
} from "./model.js";
import {
  chapterPath,
  instituteOriginal,
  instituteCreditsPath,
  institutePath,
  sectionPath,
} from "./paths.js";
import { effectChapters, effectPrerequisites } from "./prerequisites.js";

export const InstitutePage = Html.component({
  message: Schema.Never,
  model: Schema.Null,
  name: "InstitutePage",
  props: InstitutePageProps,
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) => {
    const { props } = h;

    const link = (href: string, label: string) =>
      h.a.attr("href", href).children(label);

    const kitLinks = (
      title: string,
      links: readonly { readonly href: string; readonly title: string }[]
    ) =>
      h.section(
        h.h2(title),
        h.p(link(instituteOriginal, "By Kit Langton")),
        h.ul(...links.map((item) => h.li(link(item.href, item.title))))
      );

    const footer = h.footer(
      h.p(
        "Based on the ",
        link(instituteOriginal, "Effect Institute"),
        ". ",
        link(instituteCreditsPath, "Credits")
      )
    );

    const header = h.nav
      .attr("aria-label", "Ratstack Institute")
      .children(
        link("/", "ratstack.sh"),
        " / ",
        h.a
          .attrs({ href: institutePath, "data-institute-home": "" })
          .children(instituteTitle),
        " / ",
        link("https://github.com/joelhooks/rat-stack", "Source")
      );

    if (props.kind === "credits") {
      return h.main
        .attr("class", "institute-page")
        .children(
          header,
          h.h1("Credits"),
          h.p(
            "Based on the ",
            link(instituteOriginal, "Effect Institute"),
            " by Kit Langton."
          ),
          h.p(narrationCredit),
          h.h2("MIT license"),
          h.pre.attr("class", "institute-license").children(mitNotice),
          footer
        );
    }

    if (props.kind === "home") {
      return h.main
        .attr("class", "institute-page")
        .children(
          header,
          h.h1(instituteTitle),
          h.p(instituteDescription),
          h.section(
            h.h2("Chapters"),
            props.chapters.length === 0
              ? h.p("No rat-stack chapters are published yet.")
              : h.ol(
                  ...props.chapters.map((chapter) =>
                    h.li(
                      link(chapterPath(chapter.id), chapter.title),
                      h.p(chapter.description)
                    )
                  )
                )
          ),
          kitLinks("Start with Effect", effectChapters),
          footer
        );
    }

    const prerequisites = effectPrerequisites(props.section.id);

    return h.main.attr("class", "institute-page").children(
      header,
      h.h1(props.chapter.title),
      h.p(props.chapter.description),
      h.p(
        link(
          "https://github.com/joelhooks/rat-stack",
          "By rat-stack contributors"
        )
      ),
      h.div.attr("class", "institute-chapter").children(
        h.article.attr("aria-label", "Lesson").children(
          h.div
            .attrs({
              "data-chapter": props.chapter.id,
              "data-section": props.section.id,
              "data-section-url": props.sectionUrl,
              id: institutePlayerId,
              "data-audio-url": props.audioUrl,
            })
            .children(h.h2(props.section.title), h.p(props.text)),
          ...(props.next === undefined
            ? []
            : [
                h.p(
                  h.a
                    .attrs({
                      href: sectionPath(props.chapter.id, props.next.id),
                      "data-institute-next": "",
                    })
                    .children(`Next: ${props.next.title}`)
                ),
              ]),
          ...(props.nextChapter === undefined
            ? []
            : [
                h.p(
                  link(
                    chapterPath(props.nextChapter.id),
                    `Next chapter: ${props.nextChapter.title}`
                  )
                ),
              ]),
          ...(prerequisites.length === 0
            ? []
            : [kitLinks("Prerequisites", prerequisites)])
        ),
        h.nav.attr("aria-label", "Chapter sections").children(
          h.h2("Sections"),
          h.ol(
            ...props.sections.map((section) =>
              h.li(
                h.a
                  .attrs({
                    href: sectionPath(props.chapter.id, section.id),
                    "data-institute-section-link": "",
                    "aria-current":
                      section.id === props.section.id ? "page" : undefined,
                  })
                  .children(section.title)
              )
            )
          ),
          ...(props.previous === undefined
            ? []
            : [
                h.p(
                  h.a
                    .attrs({
                      href: sectionPath(props.chapter.id, props.previous.id),
                      "data-institute-previous": "",
                    })
                    .children(`Previous: ${props.previous.title}`)
                ),
              ])
        )
      ),
      footer
    );
  },
});
