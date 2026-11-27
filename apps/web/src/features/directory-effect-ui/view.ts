import type { Html } from "@effect/ui/html";
import {
  cafeDomain,
  cafeLetterInitial,
  cafeLetters,
  filterCafeProjects,
  githubProfileUrl,
  verifiedLetters,
  xProfileUrl,
} from "@rat-stack/core/contracts";
import type {
  CafeLetterValue,
  CafeProjectValue,
} from "@rat-stack/core/contracts";
import * as stylex from "@stylexjs/stylex";

import {
  DirectoryMessage,
  firstLetterToggle,
} from "../../client/directory-effect-ui/model.js";
import { cafeStyles } from "../cafe/cafe.stylex.js";
import {
  cafeSubmissionPrompt,
  directoryCopy,
  letterNames,
  projectCount,
} from "../cafe/copy.js";

type DirectoryHtml = Html.H<typeof DirectoryMessage.Type>;

const externalLink = (h: DirectoryHtml, href: string, label: string) =>
  h.a.attrs({ href, rel: "noopener noreferrer" }).children(label);

const authorView = (
  h: DirectoryHtml,
  { github, x }: CafeProjectValue["author"],
  fallback: string
) => {
  if (github !== null) {
    return externalLink(h, githubProfileUrl(github), github);
  }

  if (x !== null) {
    return externalLink(h, xProfileUrl(x), `@${x}`);
  }

  return h.span(fallback);
};

const badgeView = (
  h: DirectoryHtml,
  project: CafeProjectValue,
  letter: CafeLetterValue
) => {
  const label = `${letterNames[letter]}: ${project.stack[letter] ?? ""}`;

  return h.abbr
    .key(letter)
    .class(stylex.props(cafeStyles.badge).className ?? "")
    .attrs({ title: label, "aria-label": label })
    .children(cafeLetterInitial[letter]);
};

const projectView = (h: DirectoryHtml, project: CafeProjectValue) =>
  h.li
    .key(project.url)
    .class(stylex.props(cafeStyles.item).className ?? "")
    .children(
      h.article(
        h.p(
          externalLink(h, project.url, project.title),
          h.span
            .class(stylex.props(cafeStyles.badges).className ?? "")
            .children(
              ...verifiedLetters(project).map((letter) =>
                badgeView(h, project, letter)
              )
            )
        ),
        h.p(project.summary),
        h.p
          .class(stylex.props(cafeStyles.meta).className ?? "")
          .children(
            "by ",
            authorView(h, project.author, cafeDomain(project.url)),
            ` · updated ${project.date}`,
            ...(project.stars === null ? [] : [` · ${project.stars} stars`])
          )
      )
    );

const letterToggle = (
  h: DirectoryHtml,
  selected: readonly CafeLetterValue[],
  letter: CafeLetterValue
) => {
  const pressed = selected.includes(letter);

  const button =
    letter === cafeLetters[0] ? h.button.ref(firstLetterToggle) : h.button;

  return button
    .key(letter)
    .attrs({ "aria-pressed": String(pressed), type: "button" })
    .class(
      stylex.props(cafeStyles.badge, pressed && cafeStyles.pressed).className ??
        ""
    )
    .on("click", DirectoryMessage.ToggledStackLetter({ letter }))
    .children(letterNames[letter]);
};

export const view = (
  h: DirectoryHtml,
  projects: readonly CafeProjectValue[],
  selected: readonly CafeLetterValue[]
) => {
  const shown = filterCafeProjects(projects, selected);

  return h.div(
    h.p(directoryCopy.intro),
    h.fieldset
      .class(stylex.props(cafeStyles.filter).className ?? "")
      .children(
        h.legend(directoryCopy.filterLegend),
        ...cafeLetters.map((letter) => letterToggle(h, selected, letter)),
        ...(selected.length === 0
          ? []
          : [
              h.button
                .attr("type", "button")
                .on("click", DirectoryMessage.ClearedStackLetters())
                .children(directoryCopy.clearLabel),
            ])
      ),
    h.p
      .attrs({ "aria-live": "polite", role: "status" })
      .children(projectCount(shown.length)),
    h.ul
      .class(stylex.props(cafeStyles.list).className ?? "")
      .children(...shown.map((project) => projectView(h, project))),
    h.p(cafeSubmissionPrompt)
  );
};
