import { Effect, FileSystem, Path } from "effect";

import { ReaderInputError } from "../../mischief/scripts/reader-input-error.ts";
import { readerAssetInputs } from "../../mischief/scripts/reader-site-inputs.ts";
import type { ReaderPageFlags } from "../src/client/reader-model.ts";

export const copyReaderAssets = Effect.fn("reader.copyAssets")(
  function* copyReaderAssets(
    pages: readonly ReaderPageFlags[],
    clientDirectory: string,
    sourcePath: string
  ) {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const { directory, manifest } = yield* readerAssetInputs;

    if (!pages.every((page) => page.page.generation === manifest.generation)) {
      return yield* new ReaderInputError({
        message:
          "Reader assets and pages have different generations; regenerate all reader inputs before building",
        sourcePath,
      });
    }

    const images = [
      ...new Set([
        ...pages.map(
          (page) =>
            new URL(page.page.metadata.ogImagePath, page.origin).pathname
        ),
        ...manifest.images.filter((image) =>
          pages.some(
            (page) =>
              page.page.path !== "/" && image.startsWith(`${page.page.path}/`)
          )
        ),
      ]),
    ];

    return yield* Effect.forEach((image: string) =>
      Effect.gen(function* copyReaderImage() {
        const destination = `${clientDirectory}${image}`;

        yield* fs.makeDirectory(paths.dirname(destination), {
          recursive: true,
        });
        yield* fs.copyFile(`${directory}${image}`, destination);
      })
    )(images);
  }
);
