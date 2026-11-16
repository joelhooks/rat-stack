import { tubeRoutes } from "./bundled-content.generated.js";

export const videoPagePath = (video: {
  readonly slug: string;
}): `/tube/${string}` => `/tube/${video.slug}`;

const published = tubeRoutes;

export const isTubeVideoPath = (
  path: string,
  videos: readonly {
    readonly slug: string;
    readonly page?: unknown;
  }[] = published
) =>
  videos.some(
    (video) => video.page !== undefined && videoPagePath(video) === path
  );

export const tubeRedirectPath = (
  path: string,
  videos: readonly {
    readonly id: string;
    readonly slug: string;
    readonly page?: unknown;
  }[] = published
) => {
  const video = videos.find(
    (entry) => entry.page !== undefined && path === `/tube/${entry.id}`
  );

  return video === undefined ? undefined : videoPagePath(video);
};
