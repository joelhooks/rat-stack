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

export const TubeBasis = Schema.Literals([
  "transcript",
  "description",
  "watched-chapters",
]);

export type TubeBasisValue = typeof TubeBasis.Type;

export const tubeBases = TubeBasis.literals;

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

const TubeParagraph = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isTrimmed(),
  Schema.isPattern(/^[^\n\r]+$/u)
);

export const TubeConceptRoute = Schema.String.check(
  Schema.isPattern(
    /^\/(?:lore\/[^\s#]+|learn(?:\/[^\s#]+)?|glossary#[^\s#]+|systems\/[^\s#]+)$/u
  )
);

export const TubePage = Schema.Struct({
  basis: Schema.Literal("transcript"),
  concepts: Schema.Array(
    Schema.Struct({ route: TubeConceptRoute, term: TubeLine })
  ),
  gaps: Schema.Array(TubeLine),
  sections: Schema.Array(
    Schema.Struct({
      at: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      note: TubeParagraph,
    })
  ),
  summary: Schema.Array(TubeParagraph).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(4)
  ),
  written: IsoDate,
});

export const TubeVideo = Schema.Struct({
  basis: TubeBasis,
  channel: TubeLine,
  channelUrl: TubeHttpsUrl,
  checked: IsoDate,
  durationSeconds: Schema.Int.check(Schema.isGreaterThan(0)),
  id: YoutubeVideoId,
  page: Schema.optional(TubePage),
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

export const tubePageVideos = (data: TubeDataValue) =>
  data.videos.filter((video) => video.page !== undefined);

export const videoPagePath = (id: string): `/tube/${string}` => `/tube/${id}`;

export const isTubeVideoPath = (path: string) =>
  /^\/tube\/[A-Za-z0-9_-]{11}$/u.test(path);

export const videoPageDescription = (video: TubeVideoValue) =>
  (video.page?.summary[0] ?? "").slice(0, 160).replace(/\s+\S*$/u, "");

export const videoObject = (video: TubeVideoValue) => ({
  "@context": "https://schema.org",
  "@type": "VideoObject",
  description: videoPageDescription(video),
  duration: `PT${video.durationSeconds}S`,
  embedUrl: embedUrl(video.id),
  name: video.title,
  thumbnailUrl: thumbnailUrl(video.id),
  uploadDate: video.published,
});

export const relatedVideos = (
  video: TubeVideoValue,
  videos: readonly TubeVideoValue[]
) =>
  videos
    .flatMap((candidate) => {
      if (candidate.id === video.id || candidate.page === undefined) {
        return [];
      }

      const score =
        Number(candidate.theme === video.theme) +
        candidate.page.concepts.filter(
          (concept) =>
            video.page?.concepts.some(
              (other) => other.route === concept.route
            ) === true
        ).length;

      return score > 0 ? [{ candidate, score }] : [];
    })
    .toSorted((left, right) => right.score - left.score)
    .slice(0, 4)
    .map(({ candidate }) => candidate);

export const summaryLinks = (text: string, video: TubeVideoValue) => {
  const matches = (video.page?.concepts ?? [])
    .flatMap((concept) => {
      const index = text.toLowerCase().indexOf(concept.term.toLowerCase());

      return index === -1 ? [] : [{ concept, index }];
    })
    .toSorted((left, right) => left.index - right.index);

  const parts: { text: string; route?: string }[] = [];
  let cursor = 0;

  for (const { concept, index } of matches) {
    if (index < cursor) {
      continue;
    }

    parts.push(
      { text: text.slice(cursor, index) },
      {
        text: text.slice(index, index + concept.term.length),
        route: concept.route,
      }
    );
    cursor = index + concept.term.length;
  }

  parts.push({ text: text.slice(cursor) });

  return parts;
};

export const thumbnailUrl = (id: string) =>
  `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

export const thumbnailWidth = 320;

export const thumbnailHeight = 180;

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
