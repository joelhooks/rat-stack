import {
  cafeDomain,
  cafeLetterInitial,
  cafeLetters,
  filterCafeProjects,
  verifiedLetters,
} from "@rat-stack/core/contracts";
import type {
  CafeLetterValue,
  CafeProjectValue,
} from "@rat-stack/core/contracts";
import * as stylex from "@stylexjs/stylex";
import { Array } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../../client/cafe/message.js";
import type { CafeMessage } from "../../client/cafe/message.js";
import type { DirectoryModel } from "../../client/cafe/model.js";
import { cafeStyles } from "./cafe.stylex.js";
import { directoryCopy, letterNames, projectCount } from "./copy.js";
import { authorView } from "./news.js";

const badgeView = (
  h: HtmlBuilder<CafeMessage>,
  project: CafeProjectValue,
  letter: CafeLetterValue
): Html =>
  h.abbr(
    [
      h.Key(letter),
      h.Class(stylex.props(cafeStyles.badge).className ?? ""),
      h.Title(`${letterNames[letter]}: ${project.stack[letter] ?? ""}`),
      h.AriaLabel(`${letterNames[letter]}: ${project.stack[letter] ?? ""}`),
    ],
    [cafeLetterInitial[letter]]
  );

const projectView = (
  h: HtmlBuilder<CafeMessage>,
  project: CafeProjectValue
): Html =>
  h.li(
    [
      h.Key(project.url),
      h.Class(stylex.props(cafeStyles.item).className ?? ""),
    ],
    [
      h.article(
        [],
        [
          h.p(
            [],
            [
              h.a(
                [h.Href(project.url), h.Rel("noopener noreferrer")],
                [project.title]
              ),
              h.span(
                [h.Class(stylex.props(cafeStyles.badges).className ?? "")],
                verifiedLetters(project).map((letter) =>
                  badgeView(h, project, letter)
                )
              ),
            ]
          ),
          h.p([], [project.summary]),
          h.p(
            [h.Class(stylex.props(cafeStyles.meta).className ?? "")],
            [
              "by ",
              authorView(h, project.author, cafeDomain(project.url)),
              ` · updated ${project.date}`,
              ...(project.stars === null ? [] : [` · ${project.stars} stars`]),
            ]
          ),
        ]
      ),
    ]
  );

const letterToggle = (
  h: HtmlBuilder<CafeMessage>,
  selected: readonly CafeLetterValue[],
  letter: CafeLetterValue
): Html =>
  h.button(
    [
      h.Key(letter),
      h.Type("button"),
      h.AriaPressed(String(selected.includes(letter))),
      h.Class(
        stylex.props(
          cafeStyles.badge,
          selected.includes(letter) && cafeStyles.pressed
        ).className ?? ""
      ),
      h.OnClick(Message.ToggledStackLetter({ letter })),
    ],
    [letterNames[letter]]
  );

export const view = (
  model: DirectoryModel,
  h: HtmlBuilder<CafeMessage>
): Html => {
  const shown = filterCafeProjects(model.projects, model.selected);

  return h.div(
    [],
    [
      h.p([], [directoryCopy.intro]),
      h.fieldset(
        [h.Class(stylex.props(cafeStyles.filter).className ?? "")],
        [
          h.legend([], [directoryCopy.filterLegend]),
          ...cafeLetters.map((letter) =>
            letterToggle(h, model.selected, letter)
          ),
          ...Array.match(model.selected, {
            onEmpty: () => [],
            onNonEmpty: () => [
              h.button(
                [h.Type("button"), h.OnClick(Message.ClearedStackLetters())],
                [directoryCopy.clearLabel]
              ),
            ],
          }),
        ]
      ),
      h.p(
        [h.Role("status"), h.AriaLive("polite")],
        [projectCount(shown.length)]
      ),
      h.ul(
        [h.Class(stylex.props(cafeStyles.list).className ?? "")],
        shown.map((project) => projectView(h, project))
      ),
    ]
  );
};
