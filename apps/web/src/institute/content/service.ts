import { Context, Effect, Layer, Schema } from "effect";

import type { InstituteAssetError } from "./institute-asset-error.js";
import { InstituteChapterNotFound } from "./institute-chapter-not-found.js";
import { InstituteContentInvalid } from "./institute-content-invalid.js";
import { InstituteSectionNotFound } from "./institute-section-not-found.js";
import { chapterAssetPath, instituteManifestPath } from "./paths.js";
import {
  ChapterManifestSchema,
  CourseManifestSchema,
  SectionSchema,
} from "./schema.js";

export type ReadInstituteAsset = (
  path: string
) => Effect.Effect<string, InstituteAssetError>;

const decodeAsset = <S extends Schema.Decoder<unknown>>(
  schema: S,
  path: string,
  readAsset: ReadInstituteAsset
) =>
  readAsset(path).pipe(
    Effect.flatMap((raw) =>
      Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
        Effect.mapError(
          (cause) =>
            new InstituteContentInvalid({ path, reason: cause.message })
        )
      )
    )
  );

export class InstituteContent extends Context.Service<InstituteContent>()(
  "@rat-stack/web/InstituteContent",
  {
    make: (readAsset: ReadInstituteAsset) =>
      Effect.sync(() => {
        const manifest = Effect.suspend(() =>
          decodeAsset(CourseManifestSchema, instituteManifestPath, readAsset)
        );

        const chapter = Effect.fn("InstituteContent.chapter")(function* chapter(
          id: string
        ) {
          const course = yield* manifest;

          if (!course.chapters.some((entry) => entry.id === id)) {
            return yield* new InstituteChapterNotFound({ chapterId: id });
          }

          const path = chapterAssetPath(id, "manifest.json");

          const decoded = yield* decodeAsset(
            ChapterManifestSchema,
            path,
            readAsset
          );

          if (decoded.id !== id) {
            return yield* new InstituteContentInvalid({
              path,
              reason: `expected chapter id ${id}, got ${decoded.id}`,
            });
          }

          return decoded;
        });

        const section = Effect.fn("InstituteContent.section")(function* section(
          chapterId: string,
          sectionId: string
        ) {
          const chapterManifest = yield* chapter(chapterId);

          const entry = chapterManifest.sections.find(
            ({ id }) => id === sectionId
          );

          if (entry === undefined) {
            return yield* new InstituteSectionNotFound({
              chapterId,
              sectionId,
            });
          }

          const path = chapterAssetPath(chapterId, entry.file);
          const decoded = yield* decodeAsset(SectionSchema, path, readAsset);

          if (decoded.id !== sectionId) {
            return yield* new InstituteContentInvalid({
              path,
              reason: `expected section id ${sectionId}, got ${decoded.id}`,
            });
          }

          return decoded;
        });

        return { manifest, chapter, section };
      }),
  }
) {
  static readonly layer = (readAsset: ReadInstituteAsset) =>
    Layer.effect(this, this.make(readAsset));
}
