import { Effect, FileSystem, Path } from "effect";

import {
  tubeCopy,
  tubeDataPath,
  tubeRoutePath,
} from "../../web/src/features/tube/copy.ts";
import { ReaderInputError } from "./reader-input-error.ts";
import { prepareReaderSiteInputs } from "./reader-site-inputs.ts";
import { decodeTubeData } from "./tube-pages.ts";

export const readerTubeFlags = Effect.fn("readerTubeFlags")(
  function* readerTubeFlags(origin: string) {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const inputs = yield* prepareReaderSiteInputs;
    const page = inputs.pages.find((entry) => entry.path === tubeRoutePath);

    if (page === undefined) {
      return yield* new ReaderInputError({
        message: `The content manifest has no ${tubeRoutePath} page; regenerate content before preparing the reader`,
        sourcePath: tubeDataPath,
      });
    }

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
              message: `Cannot read ${tubeDataPath} for the reader; run the content build to see each invalid entry`,
              sourcePath: tubeDataPath,
            })
        )
      );

    return {
      bibliography: [],
      blocks: [],
      codeFences: [],
      copyPrompts: [],
      heading: tubeCopy.heading,
      origin,
      page: {
        generation: inputs.generation,
        metadata: page.metadata,
        path: tubeRoutePath,
        sourcePath: tubeDataPath,
        status: 200,
      },
      snippets: [],
      terms: [],
      tube: { videos: data.videos },
    };
  }
);
