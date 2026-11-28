import { Effect, Schema } from "effect";

import { institutePath, isKitChapter } from "./paths.js";

const Slug = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
);

const ChapterSummary = Schema.Struct({
  comingSoon: Schema.optionalKey(Schema.Boolean),
  description: Schema.String,
  draft: Schema.optionalKey(Schema.Boolean),
  id: Slug,
  order: Schema.Int,
  title: Schema.String,
});

const CourseManifest = Schema.Struct({
  chapters: Schema.Array(ChapterSummary),
});

const ChapterManifest = Schema.Struct({
  id: Slug,
  sections: Schema.Array(
    Schema.Struct({
      file: Schema.String.check(
        Schema.isPattern(/^[a-z0-9-]+\.[a-f0-9]{8}\.json$/u)
      ),
      id: Slug,
    })
  ),
});

const SectionPreview = Schema.Struct({
  audioFile: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[a-z0-9-]+\.[a-f0-9]{8}\.webm$/u))
  ),
  id: Slug,
  text: Schema.String,
});

export type AssetFetch = (request: Request) => Promise<Response>;

class InstituteArtifactError extends Schema.TaggedError<
  InstituteArtifactError,
  { readonly brand: unique symbol }
>()("InstituteArtifactError", {
  cause: Schema.Defect(),
  path: Schema.String,
}) {}

const fetchArtifact = Effect.fn("institute.fetchArtifact")(
  function* fetchArtifact(fetchAsset: AssetFetch, url: URL) {
    const path = url.pathname;

    const response = yield* Effect.tryPromise({
      catch: (cause) => new InstituteArtifactError({ cause, path }),
      try: () => fetchAsset(new Request(url)),
    });

    if (!response.ok) {
      return yield* new InstituteArtifactError({
        cause: response.status,
        path,
      });
    }

    return yield* Effect.tryPromise({
      catch: (cause) => new InstituteArtifactError({ cause, path }),
      try: () => response.text(),
    });
  }
);

export const artifactReader = (fetchAsset: AssetFetch, origin: string) => {
  const read = (file: string) =>
    fetchArtifact(
      fetchAsset,
      new URL(`${institutePath}/content/${file}`, origin)
    );

  return {
    chapter: (id: string) =>
      read(`${id}/manifest.json`).pipe(
        Effect.flatMap(
          Schema.decodeEffect(Schema.fromJsonString(ChapterManifest))
        )
      ),
    manifest: read("manifest.json").pipe(
      Effect.flatMap(
        Schema.decodeEffect(Schema.fromJsonString(CourseManifest))
      ),
      Effect.map(({ chapters }) =>
        chapters
          .filter(
            (chapter) =>
              !isKitChapter(chapter.id) &&
              chapter.draft !== true &&
              chapter.comingSoon !== true
          )
          .toSorted((left, right) => left.order - right.order)
      )
    ),
    section: (chapter: string, file: string) =>
      read(`${chapter}/${file}`).pipe(
        Effect.flatMap(
          Schema.decodeEffect(Schema.fromJsonString(SectionPreview))
        )
      ),
  };
};
