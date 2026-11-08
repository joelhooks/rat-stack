import { Button } from "@foldkit/ui";
import * as stylex from "@stylexjs/stylex";
import { Option } from "effect";
import { Submodel } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import {
  embedUrl,
  formatDuration,
  thumbnailUrl,
  tubeThemes,
} from "../../client/tube/data.js";
import type { TubeThemeValue, TubeVideoValue } from "../../client/tube/data.js";
import { Message } from "../../client/tube/message.js";
import type { TubeMessage } from "../../client/tube/message.js";
import type { TubeModel } from "../../client/tube/model.js";
import { themeCopy, tierLabel, tubeCopy } from "./copy.js";
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
                  h.Width("480"),
                  h.Height("270"),
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
          h.a([h.Href(video.url), h.Rel("noopener noreferrer")], [video.title]),
        ]
      ),
      h.p(
        [h.Class(className(tubeStyles.meta))],
        [
          h.a(
            [h.Href(video.channelUrl), h.Rel("noopener noreferrer")],
            [video.channel]
          ),
          ` · ${formatDuration(video.durationSeconds)} · ${video.published.slice(0, 4)}`,
        ]
      ),
      h.p([h.Class(className(tubeStyles.take))], [video.take]),
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
            h.p([], [themeCopy[theme].blurb]),
            h.ul(
              [h.Class(className(tubeStyles.cards))],
              videos.map((video) => cardView(model, video, h))
            ),
          ]
        ),
      ];
};

const presentThemes = (model: TubeModel) =>
  tubeThemes.filter((theme) =>
    model.videos.some((video) => video.theme === theme)
  );

const picksView = (
  model: TubeModel,
  h: HtmlBuilder<TubeMessage>
): readonly Html[] => {
  const picks = model.videos.filter((video) => video.tier === "S");

  return picks.length === 0
    ? []
    : [
        h.h2([], [tubeCopy.picksHeading]),
        h.p([], [tubeCopy.picksIntro]),
        h.ol(
          [],
          picks.map((video) =>
            h.li(
              [h.Key(video.id)],
              [
                h.a([h.Href(`#${videoAnchor(video.id)}`)], [video.title]),
                ` (${themeCopy[video.theme].name}, ${formatDuration(video.durationSeconds)})`,
              ]
            )
          )
        ),
      ];
};

export const view = Submodel.defineView<TubeModel, TubeMessage>((model, h) =>
  h.div(
    [],
    [
      h.p([], [tubeCopy.intro]),
      h.p([], [tubeCopy.rankRule]),
      h.p([], [tubeCopy.disclosure]),
      h.nav(
        [h.AriaLabel(tubeCopy.themesLabel)],
        [
          h.ul(
            [h.Class(className(tubeStyles.themes))],
            presentThemes(model).map((theme) =>
              h.li(
                [h.Key(theme)],
                [
                  h.a(
                    [h.Href(`#${themeAnchor(theme)}`)],
                    [themeCopy[theme].name]
                  ),
                ]
              )
            )
          ),
        ]
      ),
      ...picksView(model, h),
      ...tubeThemes.flatMap((theme) => themeView(model, theme, h)),
    ]
  )
);
