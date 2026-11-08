import { IsoDate } from "@rat-stack/core/contracts";
import { Array, Order, Schema } from "effect";

export const TubeTheme = Schema.Literals([
  "effect",
  "alchemy",
  "xstate",
  "typescript",
  "agents",
  "cloudflare",
  "systems",
]);

export type TubeThemeValue = typeof TubeTheme.Type;

export const tubeThemes = TubeTheme.literals;

export const TubeTier = Schema.Literals(["S", "A", "B", "C", "D", "E", "F"]);

export type TubeTierValue = typeof TubeTier.Type;

export const tubeTiers = TubeTier.literals;

export const YoutubeVideoId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{11}$/u)
);

const TubeHttpsUrl = Schema.String.check(
  Schema.isPattern(/^https:\/\/[^\s/]+(?:\/\S*)?$/u)
);

const TubeLine = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isTrimmed(),
  Schema.isMaxLength(200),
  Schema.isPattern(/^[^\n\r]*$/u)
);

export const takeSentences = (text: string) =>
  text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'`])/u).length;

export const TubeTake = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isTrimmed(),
  Schema.isMaxLength(420),
  Schema.isPattern(/^[^\n\r]*[.!?]$/u),
  Schema.makeFilter<string>((text) => takeSentences(text) <= 3, {
    expected: "one to three sentences",
  })
);

export const TubeVideo = Schema.Struct({
  channel: TubeLine,
  channelUrl: TubeHttpsUrl,
  checked: IsoDate,
  durationSeconds: Schema.Int.check(Schema.isGreaterThan(0)),
  id: YoutubeVideoId,
  published: IsoDate,
  take: TubeTake,
  theme: TubeTheme,
  tier: TubeTier,
  title: TubeLine,
  url: TubeHttpsUrl,
});

export type TubeVideoValue = typeof TubeVideo.Type;

export const TubeData = Schema.Struct({
  videos: Schema.Array(TubeVideo),
});

export type TubeDataValue = typeof TubeData.Type;

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export const thumbnailUrl = (id: string) =>
  `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export const embedUrl = (id: string) =>
  `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`;

const byTier = Order.mapInput(
  Order.Number,
  (video: { readonly tier: TubeTierValue }) => tubeTiers.indexOf(video.tier)
);

export const rankTube = <A extends { readonly tier: TubeTierValue }>(
  videos: readonly A[]
): readonly A[] => Array.sort(videos, byTier);

export const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");

  return hours === 0
    ? `${minutes}:${rest}`
    : `${hours}:${String(minutes).padStart(2, "0")}:${rest}`;
};
