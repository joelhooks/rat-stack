import { Effect, FileSystem, Path } from "effect";

import {
  relatedVideos,
  videoPagePath,
} from "../../web/src/client/tube/data.ts";
import {
  tubeCopy,
  tubeDataPath,
  tubeRoutePath,
} from "../../web/src/features/tube/copy.ts";
import { ReaderInputError } from "./reader-input-error.ts";
import { prepareReaderSiteInputs } from "./reader-site-inputs.ts";
import { decodeTubeData } from "./tube-pages.ts";

export const tubeManifestMissing = `The content manifest has no ${tubeRoutePath} page. The reader prerenders ${tubeRoutePath} from the manifest that the content build writes. Fix: run \`pnpm --filter @rat-stack/site generate\`, then build the reader again.`;

export const tubeDataUnreadable = `Cannot read ${tubeDataPath} for the reader. The file is missing or fails the tube schema. Fix: run \`pnpm --filter @rat-stack/site generate\` to list each invalid entry, and correct them in \`${tubeDataPath}\`.`;

export const readerTubePagesFlags = Effect.fn("readerTubePagesFlags")(
  function* readerTubePagesFlags(origin: string) {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const inputs = yield* prepareReaderSiteInputs;

    const data = yield* fs
      .readFileString(
        paths.join(new URL("../../../", import.meta.url).pathname, tubeDataPath)
      )
      .pipe(
        Effect.flatMap(decodeTubeData),
        Effect.mapError(
          (cause) =>
            new ReaderInputError({
              cause,
              message: tubeDataUnreadable,
              sourcePath: tubeDataPath,
            })
        )
      );

    const ids = [
      undefined,
      ...data.videos
        .filter((video) => video.page !== undefined)
        .map((video) => video.id),
    ];

    return yield* Effect.forEach((videoId: string | undefined) =>
      Effect.gen(function* tubeFlags() {
        const selected = data.videos.find((video) => video.id === videoId);

        const route =
          selected === undefined ? tubeRoutePath : videoPagePath(selected);

        const page = inputs.pages.find((entry) => entry.path === route);

        if (page === undefined) {
          return yield* new ReaderInputError({
            message: tubeManifestMissing,
            sourcePath: route,
          });
        }

        return {
          bibliography: [],
          blocks: [],
          codeFences: [],
          copyPrompts: [],
          heading: selected?.title ?? tubeCopy.heading,
          origin,
          page: {
            generation: inputs.generation,
            metadata: page.metadata,
            path: route,
            sourcePath: tubeDataPath,
            status: 200,
          },
          snippets: [],
          terms: [],
          tube: {
            selected: videoId,
            videos:
              selected === undefined
                ? data.videos
                : [
                    selected,
                    ...relatedVideos(selected, data.videos).map(
                      ({ page: _page, ...metadata }) => metadata
                    ),
                  ],
          },
        };
      })
    )(ids);
  }
);

export const readerTubeFlags = Effect.fn("readerTubeFlags")(
  function* readerTubeFlags(origin: string, videoId?: string) {
    const pages = yield* readerTubePagesFlags(origin);

    const page = pages.find((entry) => entry.tube.selected === videoId);

    if (page === undefined) {
      return yield* new ReaderInputError({
        message: tubeManifestMissing,
        sourcePath: videoId ?? tubeRoutePath,
      });
    }

    return page;
  }
);
