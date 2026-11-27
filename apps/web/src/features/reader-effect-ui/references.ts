import type { Html } from "@effect/ui/html";
import { Option } from "effect";

import type {
  ReaderMessage,
  ReaderPageProps,
} from "../../client/reader-effect-ui/model.js";

type ReaderHtml = Html.H<typeof ReaderMessage.Type>;

type References = Option.Option.Value<ReaderPageProps["references"]>;

export const bibliographyView = (
  h: ReaderHtml,
  sources: ReaderPageProps["bibliography"]
) =>
  sources.length === 0
    ? []
    : [
        h.section
          .attrs({ "aria-labelledby": "sources", class: "bibliography" })
          .children(
            h.h2.attr("id", "sources").children("Sources"),
            h.ol(
              ...sources.map((source, index) =>
                h.li
                  .attr("id", `source-${index + 1}`)
                  .children(
                    ...(source.kind === "linked"
                      ? [
                          h.a.attr("href", source.url).children(source.title),
                          `. ${source.publisher}. ${source.note} Accessed ${source.accessed}.`,
                        ]
                      : [
                          `${source.title}. Recorded ${source.recordedAt}. ${source.note}.`,
                        ])
                  )
              )
            )
          ),
      ];

const backlinksView = (h: ReaderHtml, backlinks: References["backlinks"]) =>
  backlinks.length === 0
    ? []
    : [
        h.section
          .attrs({
            "aria-labelledby": "linked-from",
            class: "bibliography linked-from",
          })
          .children(
            h.h2.attr("id", "linked-from").children("Linked from"),
            h.ol(
              ...backlinks.map((reference) =>
                h.li(
                  h.a.attr("href", reference.route).children(reference.title),
                  `. ${reference.description}`,
                  ...(reference.context === "" ? [] : [h.p(reference.context)])
                )
              )
            )
          ),
      ];

const lastChangeView = (
  h: ReaderHtml,
  sourcePath: string,
  change: References["lastChange"]
) =>
  change === undefined
    ? []
    : [
        h.hr,
        h.p(
          `Last changed ${change.date} in `,
          h.a
            .attr(
              "href",
              `https://github.com/joelhooks/rat-stack/commit/${change.hash}`
            )
            .children(change.short),
          ". ",
          h.a
            .attr(
              "href",
              `https://github.com/joelhooks/rat-stack/blob/main/${sourcePath}`
            )
            .children("Source on GitHub"),
          ". ",
          h.a.attr("href", "/log").children("Change log"),
          "."
        ),
      ];

export const referencesView = (h: ReaderHtml, props: ReaderPageProps) =>
  Option.match(props.references, {
    onNone: () => [],
    onSome: (references) => [
      ...lastChangeView(h, props.page.sourcePath, references.lastChange),
      ...backlinksView(h, references.backlinks),
    ],
  });
