import { Array, Option, String } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { ReaderModel } from "../client/reader/model.js";
import { changeLogRouter } from "./site-route.js";

type References = Option.Option.Value<ReaderModel["references"]>;

const lastChangeView = <Message>(
  model: ReaderModel,
  references: References,
  h: HtmlBuilder<Message>
): readonly Html[] =>
  Option.match(Option.fromNullishOr(references.lastChange), {
    onNone: () => [],
    onSome: (change) => [
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
    ],
  });

const backlinksView = <Message>(
  references: References,
  h: HtmlBuilder<Message>
): readonly Html[] =>
  Array.match(references.backlinks, {
    onEmpty: () => [],
    onNonEmpty: (backlinks) => [
      h.section(
        [h.Class("bibliography linked-from"), h.AriaLabelledBy("linked-from")],
        [
          h.h2([h.Id("linked-from")], ["Linked from"]),
          h.ol(
            [],
            backlinks.map((reference) =>
              h.li(
                [],
                [
                  h.a([h.Href(reference.route)], [reference.title]),
                  `. ${reference.description}`,
                  ...(String.isEmpty(reference.context)
                    ? []
                    : [h.p([], [reference.context])]),
                ]
              )
            )
          ),
        ]
      ),
    ],
  });

export const readerReferences = <Message>(
  model: ReaderModel,
  h: HtmlBuilder<Message>
): readonly Html[] =>
  Option.match(model.references, {
    onNone: () => [],
    onSome: (references) => [
      ...lastChangeView(model, references, h),
      ...backlinksView(references, h),
    ],
  });
