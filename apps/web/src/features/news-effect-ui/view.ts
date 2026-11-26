import type { Html } from "@effect/ui/html";
import {
  cafeDomain,
  githubProfileUrl,
  xProfileUrl,
} from "@rat-stack/core/contracts";
import type { CafeNewsItemValue } from "@rat-stack/core/contracts";
import * as stylex from "@stylexjs/stylex";
import { Option } from "effect";

import type { NewsPageProps } from "../../client/news-effect-ui/model.js";
import { cafeStyles } from "../cafe/cafe.stylex.js";
import {
  allStarsCopy,
  cafeSubmissionPrompt,
  newsCopy,
  newsKindLabels,
  shownReplies,
  sortRules,
  sortRulesLead,
  sortSignals,
  sortSignalsLead,
  sortSources,
  threadCounts,
} from "../cafe/copy.js";
import { otherNewsOrder } from "../cafe/news-order.js";
import { newsFeedRouter } from "../site-route.js";

type NewsHtml = Html.H<never>;

const externalLink = (h: NewsHtml, href: string, label: string) =>
  h.a.attrs({ href, rel: "noopener noreferrer" }).children(label);

const authorView = (
  h: NewsHtml,
  { github, x }: CafeNewsItemValue["author"],
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

const threadView = (h: NewsHtml, item: CafeNewsItemValue) =>
  item.kind === "thread"
    ? [
        h.p
          .class(stylex.props(cafeStyles.meta).className ?? "")
          .children(
            threadCounts(item.engagement.replies, item.engagement.participants)
          ),
        h.details
          .class(stylex.props(cafeStyles.replies).className ?? "")
          .children(
            h.summary(newsCopy.repliesLabel),
            h.ul(
              ...item.topReplies
                .slice(0, shownReplies)
                .map((reply) =>
                  h.li
                    .key(reply.url)
                    .children(
                      externalLink(h, xProfileUrl(reply.x), `@${reply.x}`),
                      `: ${reply.text} `,
                      externalLink(h, reply.url, `${reply.likes} likes`)
                    )
                )
            )
          ),
      ]
    : [];

const itemView = (
  h: NewsHtml,
  item: CafeNewsItemValue,
  profile: NewsPageProps["profiles"][number] | undefined
) =>
  h.li
    .key(item.url)
    .class(stylex.props(cafeStyles.item).className ?? "")
    .children(
      h.article(
        h.p(
          h.span
            .class(stylex.props(cafeStyles.tag).className ?? "")
            .children(`[${newsKindLabels[item.kind]}]`),
          externalLink(h, item.url, item.title),
          h.span
            .class(stylex.props(cafeStyles.meta).className ?? "")
            .children(` (${cafeDomain(item.url)})`)
        ),
        ...Option.toArray(Option.fromNullishOr(item.summary)).map((summary) =>
          h.p(summary)
        ),
        ...(item.interest === undefined
          ? []
          : [
              h.p
                .class(stylex.props(cafeStyles.meta).className ?? "")
                .children(item.interest.why),
            ]),
        h.p.class(stylex.props(cafeStyles.meta).className ?? "").children(
          h.time(item.date),
          " by ",
          authorView(h, item.author, cafeDomain(item.url)),
          ...(profile === undefined
            ? []
            : [
                " · ",
                h.a
                  .attrs({
                    href: profile.route,
                    "aria-label": `${profile.name} on all stars`,
                  })
                  .children(allStarsCopy.profileLabel),
              ])
        ),
        ...threadView(h, item)
      )
    );

const sortSectionView = (h: NewsHtml) =>
  h.section
    .attr("aria-labelledby", "how-this-list-is-sorted")
    .children(
      h.h2.attr("id", "how-this-list-is-sorted").children(newsCopy.sortHeading),
      h.p(sortSignalsLead),
      h.ul(...sortSignals.map((signal) => h.li(signal))),
      h.p(sortRulesLead),
      h.ul(...sortRules.map((rule) => h.li(rule))),
      h.p(
        newsCopy.priorArtLead,
        ...sortSources.flatMap((source, index) => [
          ...(index === 0 ? [] : [", "]),
          externalLink(h, source.href, source.label),
        ]),
        "."
      )
    );

export const view = (
  h: NewsHtml,
  { items, profiles }: NewsPageProps,
  sort: NewsPageProps["sort"]
) => {
  const other = otherNewsOrder(sort);

  const profilesByUrl = new Map(
    profiles.map((profile) => [profile.url, profile])
  );

  return h.div(
    h.p(newsCopy.intro),
    h.p(
      h.a.attr("href", other.href).children(other.label),
      " · ",
      h.a.attr("href", newsFeedRouter()).children(newsCopy.feedLabel)
    ),
    h.ol
      .class(stylex.props(cafeStyles.list).className ?? "")
      .children(
        ...items.map((item) => itemView(h, item, profilesByUrl.get(item.url)))
      ),
    ...(sort === "rank" ? [sortSectionView(h)] : []),
    h.p(cafeSubmissionPrompt)
  );
};
