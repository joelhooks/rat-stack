import { rankCafeNews } from "@rat-stack/core/contracts";
import type { CafeDataValue } from "@rat-stack/core/contracts";
import { Array as Arr, Order } from "effect";

import { videoPagePath } from "../../web/src/client/tube/data.ts";
import type {
  TubeTierValue,
  TubeVideoValue,
} from "../../web/src/client/tube/data.ts";
import { tierLabel } from "../../web/src/features/tube/copy.ts";

export const featuredCount = 3;

export const featuredTiers: readonly TubeTierValue[] = ["S", "A"];

const newestPublished = Order.flip(
  Order.mapInput(
    Order.String,
    (video: { readonly published: string }) => video.published
  )
);

export const featuredVideos = <
  A extends { readonly published: string; readonly tier: TubeTierValue },
>(
  videos: readonly A[]
): readonly A[] =>
  Arr.sort(
    videos.filter((video) => featuredTiers.includes(video.tier)),
    newestPublished
  ).slice(0, featuredCount);

const linkText = (value: string) => value.replaceAll(/[[\]]/gu, "");

const firstSentence = (text: string) =>
  text.split(/(?<=[.!?])\s+/u).at(0) ?? text;

export const homeFeaturedMarkdown = (
  cafe: CafeDataValue,
  videos: readonly TubeVideoValue[],
  origin: string
) => {
  const news = rankCafeNews(cafe.news, cafe.rankedAt, cafe.people)
    .slice(0, featuredCount)
    .map(({ item }) =>
      [
        `- **${item.kind}, ${item.date}**: [${linkText(item.title)}](${item.url})`,
        item.summary === null ? "" : `. ${firstSentence(item.summary)}`,
      ].join("")
    );

  const watch = featuredVideos(videos).map(
    (video) =>
      `- **${tierLabel(video.tier)}**: [${linkText(video.title)}](${video.page === undefined ? video.url : videoPagePath(video)}) by ${linkText(video.channel)}. ${firstSentence(video.take)}`
  );

  return [
    "## New and worth watching",
    "",
    `The top of [Ratstack news](${origin}/news) right now:`,
    "",
    ...news,
    "",
    `The newest top-tier picks on [RatTube](${origin}/tube):`,
    "",
    ...watch,
  ].join("\n");
};
