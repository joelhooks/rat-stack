import type { FenceJob } from "@rat-stack/code-snippets";
import { Effect, FileSystem, Path } from "effect";

import { collectCodeFences } from "./code-pipeline.ts";
import type { ContentBuildError } from "./content-error.ts";
import { buildError } from "./content-error.ts";
import { lawSpecs } from "./content-specs.ts";

const fenceSourcesIn = Effect.fn("fenceSourcesIn")(function* fenceSourcesIn(
  root: string,
  directory: string
): Effect.fn.Return<
  readonly string[],
  ContentBuildError,
  FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const entries = yield* fs
    .readDirectory(path.join(root, directory))
    .pipe(
      Effect.mapError((cause) =>
        buildError("code preflight directory", directory, cause)
      )
    );

  const paths: string[] = [];

  for (const entry of entries.toSorted()) {
    const sourcePath = `${directory}/${entry}`;

    const stat = yield* fs
      .stat(path.join(root, sourcePath))
      .pipe(
        Effect.mapError((cause) =>
          buildError("code preflight stat", sourcePath, cause)
        )
      );

    if (stat.type === "Directory") {
      paths.push(...(yield* fenceSourcesIn(root, sourcePath)));
    } else if (sourcePath.endsWith(".svx") || sourcePath.endsWith(".md")) {
      paths.push(sourcePath);
    }
  }

  return paths;
});

export const collectBuildFences = Effect.fn("collectBuildFences")(
  function* collectBuildFences(
    root: string
  ): Effect.fn.Return<
    readonly FenceJob[],
    ContentBuildError,
    FileSystem.FileSystem | Path.Path
  > {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const paths = [
      ...new Set([
        ...lawSpecs.map((spec) => spec.sourcePath),
        ...(yield* Effect.forEach(
          [
            ".brain/resources/lore",
            ".brain/areas",
            "skills",
            "apps/mischief/content",
          ],
          (directory) => fenceSourcesIn(root, directory)
        )).flat(),
      ]),
    ];

    const sources = yield* Effect.forEach((sourcePath: string) =>
      fs.readFileString(path.join(root, sourcePath)).pipe(
        Effect.mapError((cause) =>
          buildError("code preflight read", sourcePath, cause)
        ),
        Effect.map((source) => ({ source, sourcePath }))
      )
    )(paths);

    return sources.flatMap(({ source, sourcePath }) =>
      collectCodeFences(source, sourcePath).map((node) => ({
        node,
        sourcePath,
      }))
    );
  }
);
