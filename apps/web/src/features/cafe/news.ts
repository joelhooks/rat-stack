import {
  cafeDomain,
  githubProfileUrl,
  xProfileUrl,
} from "@rat-stack/core/contracts";
import type {
  CafeAuthor,
  CafeNewsItemValue,
  CafeReply,
} from "@rat-stack/core/contracts";
import * as stylex from "@stylexjs/stylex";
import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { CafeMessage } from "../../client/cafe/message.js";
import type { NewsModel } from "../../client/cafe/model.js";
import { newsFeedRouter } from "../site-route.js";
import { cafeStyles } from "./cafe.stylex.js";
import {
  newsCopy,
  newsKindLabels,
  sortRules,
  sortRulesLead,
  sortSignals,
  sortSignalsLead,
  sortSources,
  threadCounts,
} from "./copy.js";

const shownReplies = 3;

const externalLink = (
  h: HtmlBuilder<CafeMessage>,
  href: string,
  label: string
): Html => h.a([h.Href(href), h.Rel("noopener noreferrer")], [label]);

export const authorView = (
  h: HtmlBuilder<CafeMessage>,
  author: typeof CafeAuthor.Type,
  fallback: string
): Html => {
  if (author.github !== null) {
    return externalLink(h, githubProfileUrl(author.github), author.github);
  }

  if (author.x !== null) {
    return externalLink(h, xProfileUrl(author.x), `@${author.x}`);
  }

  return h.span([], [fallback]);
};

const replyView = (h: HtmlBuilder<CafeMessage>, reply: typeof CafeReply.Type) =>
  h.li(
    [h.Key(reply.url)],
    [
      externalLink(h, xProfileUrl(reply.x), `@${reply.x}`),
      `: ${reply.text} `,
      externalLink(h, reply.url, `${reply.likes} likes`),
    ]
  );

const threadView = (
  h: HtmlBuilder<CafeMessage>,
  item: CafeNewsItemValue
): Html[] =>
  item.kind === "thread"
    ? [
        h.p(
          [h.Class(stylex.props(cafeStyles.meta).className ?? "")],
          [threadCounts(item.engagement.replies, item.engagement.participants)]
        ),
        h.details(
          [h.Class(stylex.props(cafeStyles.replies).className ?? "")],
          [
            h.summary([], [newsCopy.repliesLabel]),
            h.ul(
              [],
              item.topReplies
                .slice(0, shownReplies)
                .map((reply) => replyView(h, reply))
            ),
          ]
        ),
      ]
    : [];

const itemView = (h: HtmlBuilder<CafeMessage>, item: CafeNewsItemValue): Html =>
  h.li(
    [h.Key(item.url), h.Class(stylex.props(cafeStyles.item).className ?? "")],
    [
      h.article(
        [],
        [
          h.p(
            [],
            [
              h.span(
                [h.Class(stylex.props(cafeStyles.tag).className ?? "")],
                [`[${newsKindLabels[item.kind]}]`]
              ),
              externalLink(h, item.url, item.title),
              h.span(
                [h.Class(stylex.props(cafeStyles.meta).className ?? "")],
                [` (${cafeDomain(item.url)})`]
              ),
            ]
          ),
          ...Option.toArray(Option.fromNullishOr(item.summary)).map((summary) =>
            h.p([], [summary])
          ),
          h.p(
            [h.Class(stylex.props(cafeStyles.meta).className ?? "")],
            [
              h.time([], [item.date]),
              " by ",
              authorView(h, item.author, cafeDomain(item.url)),
            ]
          ),
          ...threadView(h, item),
        ]
      ),
    ]
  );

const sortSectionView = (h: HtmlBuilder<CafeMessage>): Html =>
  h.section(
    [h.AriaLabelledBy("how-this-list-is-sorted")],
    [
      h.h2([h.Id("how-this-list-is-sorted")], [newsCopy.sortHeading]),
      h.p([], [sortSignalsLead]),
      h.ul(
        [],
        sortSignals.map((signal) => h.li([], [signal]))
      ),
      h.p([], [sortRulesLead]),
      h.ul(
        [],
        sortRules.map((rule) => h.li([], [rule]))
      ),
      h.p(
        [],
        [
          "Prior art: ",
          ...sortSources.flatMap((source, index) => [
            ...(index === 0 ? [] : [", "]),
            externalLink(h, source.href, source.label),
          ]),
          ".",
        ]
      ),
    ]
  );

export const view = (model: NewsModel, h: HtmlBuilder<CafeMessage>): Html =>
  h.div(
    [],
    [
      h.p([], [newsCopy.intro]),
      h.p([], [h.a([h.Href(newsFeedRouter())], [newsCopy.feedLabel])]),
      h.ol(
        [h.Class(stylex.props(cafeStyles.list).className ?? "")],
        model.items.map((item) => itemView(h, item))
      ),
      sortSectionView(h),
    ]
  );
