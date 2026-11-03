import type { CafePersonSummary } from "@rat-stack/core/contracts";
import * as stylex from "@stylexjs/stylex";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { CafeMessage } from "../../client/cafe/message.js";
import type { AllStarsModel } from "../../client/cafe/model.js";
import { allStarsFeedRouter } from "../site-route.js";
import { cafeStyles } from "./cafe.stylex.js";
import { allStarsCopy, removalIssueUrl, removalPromise } from "./copy.js";

const toolNames = [
  "listPeople",
  "readPerson",
  "searchPeople",
  "listChannels",
  "peopleFor",
] as const;

const cardView = (
  h: HtmlBuilder<CafeMessage>,
  person: typeof CafePersonSummary.Type
): Html =>
  h.li(
    [h.Key(person.id), h.Class(stylex.props(cafeStyles.card).className ?? "")],
    [
      h.img([
        h.Src(person.avatar),
        h.Alt(""),
        h.Width("64"),
        h.Height("64"),
        h.Loading("lazy"),
        h.Class(stylex.props(cafeStyles.avatar).className ?? ""),
      ]),
      h.div(
        [],
        [
          h.h3([], [h.a([h.Href(person.route)], [person.name])]),
          h.p([], [person.summary.text]),
          ...(person.repos.length === 0
            ? []
            : [
                h.p(
                  [],
                  [
                    "Built: ",
                    ...person.repos.flatMap((repo, index) => [
                      ...(index === 0 ? [] : [", "]),
                      h.a(
                        [h.Href(repo.source), h.Rel("noopener noreferrer")],
                        [repo.repo]
                      ),
                      ` (${repo.stars} stars)`,
                    ]),
                  ]
                ),
              ]),
          h.p(
            [h.Class(stylex.props(cafeStyles.meta).className ?? "")],
            [
              h.a(
                [h.Href(person.summary.source), h.Rel("noopener noreferrer")],
                ["source"]
              ),
              `, checked ${person.summary.verified}`,
            ]
          ),
        ]
      ),
    ]
  );

const sectionView = (
  h: HtmlBuilder<CafeMessage>,
  heading: string,
  people: readonly (typeof CafePersonSummary.Type)[]
): readonly Html[] =>
  people.length === 0
    ? []
    : [
        h.h2([], [heading]),
        h.ul(
          [h.Class(stylex.props(cafeStyles.cards).className ?? "")],
          people.map((person) => cardView(h, person))
        ),
      ];

export const view = (model: AllStarsModel, h: HtmlBuilder<CafeMessage>): Html =>
  h.div(
    [],
    [
      h.p([], [allStarsCopy.intro]),
      h.p([], [allStarsCopy.entryRule]),
      h.p(
        [],
        [
          "Agents can call ",
          ...toolNames.flatMap((name, index) => [
            ...(index === 0
              ? []
              : [index === toolNames.length - 1 ? " and " : ", "]),
            h.code([], [name]),
          ]),
          " over MCP, HTTP or code mode. ",
          h.a([h.Href(allStarsFeedRouter())], [allStarsCopy.feedLabel]),
          ".",
        ]
      ),
      ...sectionView(
        h,
        allStarsCopy.peopleHeading,
        model.people.filter((person) => person.kind === "person")
      ),
      ...sectionView(
        h,
        allStarsCopy.channelsHeading,
        model.people.filter((person) => person.kind === "channel")
      ),
      h.p(
        [],
        [
          "To be removed from this page, ",
          h.a([h.Href(removalIssueUrl(null))], ["open an issue"]),
          ` in joelhooks/rat-stack. ${removalPromise}`,
        ]
      ),
    ]
  );
