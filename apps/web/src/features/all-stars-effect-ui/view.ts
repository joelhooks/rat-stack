import type { Html } from "@effect/ui/html";
import type { CafePersonSummary } from "@rat-stack/core/contracts";
import * as stylex from "@stylexjs/stylex";

import { cafeStyles } from "../cafe/cafe.stylex.js";
import { allStarsCopy, removalIssueUrl, removalPromise } from "../cafe/copy.js";
import { allStarsFeedRouter } from "../site-route.js";

type AllStarsHtml = Html.H<never>;

type Person = typeof CafePersonSummary.Type;

const toolNames = [
  "listPeople",
  "readPerson",
  "searchPeople",
  "listChannels",
  "peopleFor",
];

const externalLink = (h: AllStarsHtml, href: string, label: string) =>
  h.a.attrs({ href, rel: "noopener noreferrer" }).children(label);

const repositories = (h: AllStarsHtml, { repos }: Person) =>
  repos.length === 0
    ? []
    : [
        h.p(
          "Built: ",
          ...repos.flatMap((repo, index) => [
            ...(index === 0 ? [] : [", "]),
            externalLink(h, repo.source, repo.repo),
            ` (${repo.stars} stars)`,
          ])
        ),
      ];

const cardView = (h: AllStarsHtml, person: Person) =>
  h.li
    .key(person.id)
    .class(stylex.props(cafeStyles.card).className ?? "")
    .children(
      h.img.class(stylex.props(cafeStyles.avatar).className ?? "").attrs({
        src: person.avatar,
        alt: "",
        width: "64",
        height: "64",
        loading: "lazy",
      }),
      h.div(
        h.h3(h.a.attr("href", person.route).children(person.name)),
        h.p(person.summary.text),
        ...repositories(h, person),
        h.p
          .class(stylex.props(cafeStyles.meta).className ?? "")
          .children(
            externalLink(h, person.summary.source, "source"),
            `, checked ${person.summary.verified}`
          )
      )
    );

const sectionView = (
  h: AllStarsHtml,
  heading: string,
  people: readonly Person[]
) =>
  people.length === 0
    ? []
    : [
        h.h2(heading),
        h.ul
          .class(stylex.props(cafeStyles.cards).className ?? "")
          .children(...people.map((person) => cardView(h, person))),
      ];

export const view = (h: AllStarsHtml, people: readonly Person[]) =>
  h.div(
    h.p(allStarsCopy.intro),
    h.p(allStarsCopy.entryRule),
    h.p(
      "Agents can call ",
      ...toolNames.flatMap((name, index) => [
        ...(index === 0
          ? []
          : [index === toolNames.length - 1 ? " and " : ", "]),
        h.code(name),
      ]),
      " over MCP, HTTP or code mode. ",
      h.a.attr("href", allStarsFeedRouter()).children(allStarsCopy.feedLabel),
      "."
    ),
    ...sectionView(
      h,
      allStarsCopy.peopleHeading,
      people.filter((person) => person.kind === "person")
    ),
    ...sectionView(
      h,
      allStarsCopy.channelsHeading,
      people.filter((person) => person.kind === "channel")
    ),
    h.p(
      "To be removed from this page, ",
      h.a.attr("href", removalIssueUrl(null)).children("open an issue"),
      ` in joelhooks/rat-stack. ${removalPromise}`
    )
  );
