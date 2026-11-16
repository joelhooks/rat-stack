import { Button } from "@foldkit/ui";
import * as stylex from "@stylexjs/stylex";
import { Option } from "effect";
import { Submodel } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import {
  embedUrl,
  formatDuration,
  thumbnailHeight,
  thumbnailUrl,
  thumbnailWidth,
  tubeThemes,
  videoPagePath,
  summaryLinks,
} from "../../client/tube/data.js";
import type { TubeThemeValue, TubeVideoValue } from "../../client/tube/data.js";
import { Message } from "../../client/tube/message.js";
import type { TubeMessage } from "../../client/tube/message.js";
import type { TubeModel } from "../../client/tube/model.js";
import {
  checkedLabel,
  themeCopy,
  tierLabel,
  tubeCopy,
  tubeRoutePath,
} from "./copy.js";
import { tubeStyles } from "./tube.stylex.js";

const className = (style: stylex.StyleXStyles) =>
  stylex.props(style).className ?? "";

export const videoAnchor = (id: string) => `video-${id}`;

export const themeAnchor = (theme: TubeThemeValue) => `theme-${theme}`;

const isPlaying = (model: TubeModel, video: TubeVideoValue) =>
  Option.contains(model.playing, video.id);

const mediaView = (
  model: TubeModel,
  video: TubeVideoValue,
  h: HtmlBuilder<TubeMessage>
): Html =>
  isPlaying(model, video)
    ? h.iframe([
        h.Src(embedUrl(video.id)),
        h.Title(video.title),
        h.Allow("autoplay; encrypted-media; fullscreen; picture-in-picture"),
        h.Referrerpolicy("strict-origin-when-cross-origin"),
        h.Class(className(tubeStyles.frame)),
      ])
    : Button.view(
        {
          onClick: Message.ClickedPlay({ id: video.id }),
          toView: ({ button }) =>
            h.button(
              [
                ...button,
                h.AriaLabel(`${tubeCopy.playLabel}: ${video.title}`),
                h.Class(className(tubeStyles.play)),
              ],
              [
                h.img([
                  h.Src(thumbnailUrl(video.id)),
                  h.Alt(`Video thumbnail for ${video.title}`),
                  h.Width(String(thumbnailWidth)),
                  h.Height(String(thumbnailHeight)),
                  h.Loading("lazy"),
                  h.Decoding("async"),
                  h.Referrerpolicy("no-referrer"),
                  h.Class(className(tubeStyles.thumbnail)),
                ]),
                h.span(
                  [h.Class(className(tubeStyles.playLabel))],
                  [`▶ ${tubeCopy.playLabel}`]
                ),
              ]
            ),
        },
        h
      );

const cardView = (
  model: TubeModel,
  video: TubeVideoValue,
  h: HtmlBuilder<TubeMessage>
): Html =>
  h.li(
    [
      h.Key(video.id),
      h.Id(videoAnchor(video.id)),
      h.Class(className(tubeStyles.card)),
    ],
    [
      mediaView(model, video, h),
      h.h3(
        [h.Class(className(tubeStyles.title))],
        [
          h.span(
            [h.Class(className(tubeStyles.badge))],
            [tierLabel(video.tier)]
          ),
          h.a(
            [
              h.Href(
                video.page === undefined ? video.url : videoPagePath(video)
              ),
            ],
            [video.title]
          ),
        ]
      ),
      h.p(
        [h.Class(className(tubeStyles.meta))],
        [
          h.a(
            [h.Href(video.channelUrl), h.Rel("noopener noreferrer")],
            [video.channel]
          ),
          ` · ${formatDuration(video.durationSeconds)} · ${video.published.slice(0, 4)} · ${checkedLabel(video)}`,
        ]
      ),
      h.p([h.Class(className(tubeStyles.take))], [video.take]),
      h.a(
        [h.Href(video.url), h.Rel("noopener noreferrer")],
        ["Watch on YouTube"]
      ),
    ]
  );

const themeView = (
  model: TubeModel,
  theme: TubeThemeValue,
  h: HtmlBuilder<TubeMessage>
): readonly Html[] => {
  const videos = model.videos.filter((video) => video.theme === theme);

  return videos.length === 0
    ? []
    : [
        h.section(
          [h.AriaLabelledBy(themeAnchor(theme))],
          [
            h.h2([h.Id(themeAnchor(theme))], [themeCopy[theme].name]),
            h.ul(
              [h.Class(className(tubeStyles.cards))],
              videos.map((video) => cardView(model, video, h))
            ),
          ]
        ),
      ];
};

const summaryParagraph = (
  text: string,
  video: TubeVideoValue,
  h: HtmlBuilder<TubeMessage>
): readonly (Html | string)[] =>
  summaryLinks(text, video).map((part) =>
    part.route === undefined
      ? part.text
      : h.a([h.Href(part.route)], [part.text])
  );

const videoView = (
  model: TubeModel,
  video: TubeVideoValue,
  h: HtmlBuilder<TubeMessage>
): Html =>
  h.div(
    [],
    [
      h.p(
        [],
        [h.a([h.Href(tubeRoutePath)], [`All ${tubeCopy.heading} videos`])]
      ),
      mediaView(model, video, h),
      h.p(
        [],
        [
          h.a([h.Href(video.channelUrl)], [video.channel]),
          ` · Published ${video.published} · ${formatDuration(video.durationSeconds)} · ${tierLabel(video.tier)} · ${themeCopy[video.theme].name}`,
        ]
      ),
      h.p([], [h.a([h.Href(video.url)], ["Watch on YouTube"])]),
      h.p([], [tubeCopy.disclosure]),
      h.h2([], ["Summary"]),
      ...(video.page?.summary.map((paragraph) =>
        h.p([], summaryParagraph(paragraph, video, h))
      ) ?? []),
      h.h2([], ["Section notes"]),
      h.ul(
        [],
        video.page?.sections.map(({ at, note }) =>
          h.li(
            [h.Key(String(at))],
            [
              h.a([h.Href(`${video.url}&t=${at}s`)], [formatDuration(at)]),
              `: ${note}`,
            ]
          )
        ) ?? []
      ),
      h.h2([], ["Key concepts"]),
      (video.page?.concepts.length ?? 0) === 0
        ? h.p([], ["No matching wiki page yet."])
        : h.empty,
      h.ul(
        [],
        video.page?.concepts.map(({ term, route }) =>
          h.li([h.Key(route)], [h.a([h.Href(route)], [term])])
        ) ?? []
      ),
      h.h2([], ["Our take"]),
      h.p([], [video.take]),
      h.h2([], ["Related videos"]),
      h.ul(
        [],
        model.videos.flatMap((related) =>
          related.id === video.id
            ? []
            : [
                h.li(
                  [h.Key(related.id)],
                  [h.a([h.Href(videoPagePath(related))], [related.title])]
                ),
              ]
        )
      ),
      h.p(
        [],
        [
          `Summary based on the transcript. Written ${video.page?.written ?? ""}.`,
        ]
      ),
    ]
  );

export const view = Submodel.defineView<TubeModel, TubeMessage>((model, h) => {
  const selected = model.videos.find((video) =>
    Option.contains(model.selected, video.id)
  );

  return selected === undefined
    ? h.div(
        [],
        [
          ...tubeThemes.flatMap((theme) => themeView(model, theme, h)),
          h.p([], [tubeCopy.disclosure]),
        ]
      )
    : videoView(model, selected, h);
});
