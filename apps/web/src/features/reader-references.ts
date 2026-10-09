import { Option } from "effect";
import type { HtmlBuilder } from "foldkit/html";

import type { ReaderModel } from "../client/reader/model.js";
import { changeLogRouter } from "./site-route.js";

const referencesView = <Message>(
  model: ReaderModel,
  references: Option.Option.Value<ReaderModel["references"]>,
  h: HtmlBuilder<Message>
) => {
  const { lastChange: change } = references;

  return [
    ...(change === undefined
      ? []
      : [
          h.hr([]),
          h.p(
            [],
            [
              `Last changed ${change.date} in `,
              h.a(
                [
                  h.Href(
                    `https://github.com/joelhooks/rat-stack/commit/${change.hash}`
                  ),
                ],
                [change.short]
              ),
              ". ",
              h.a(
                [
                  h.Href(
                    `https://github.com/joelhooks/rat-stack/blob/main/${model.page.sourcePath}`
                  ),
                ],
                ["Source on GitHub"]
              ),
              ". ",
              h.a([h.Href(changeLogRouter())], ["Change log"]),
              ".",
            ]
          ),
        ]),
    ...(references.backlinks.length === 0
      ? []
      : [
          h.section(
            [
              h.Class("bibliography linked-from"),
              h.AriaLabelledBy("linked-from"),
            ],
            [
              h.h2([h.Id("linked-from")], ["Linked from"]),
              h.ol(
                [],
                references.backlinks.map((reference) =>
                  h.li(
                    [],
                    [
                      h.a([h.Href(reference.route)], [reference.title]),
                      `. ${reference.description}`,
                      ...(reference.context === ""
                        ? []
                        : [h.p([], [reference.context])]),
                    ]
                  )
                )
              ),
            ]
          ),
        ]),
  ];
};

export const readerReferences = <Message>(
  model: ReaderModel,
  h: HtmlBuilder<Message>
) =>
  Option.match(model.references, {
    onNone: () => [],
    onSome: (references) => referencesView(model, references, h),
  });
