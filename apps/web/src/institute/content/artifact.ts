import { Config, Effect, FileSystem, Option, Path, Schema } from "effect";
import * as Digest from "effect/crypto/Digest";

import { InstituteAssetError } from "./institute-asset-error.js";
import {
  audioFallbackUrl,
  audioUrl,
  chapterAssetPath,
  instituteManifestPath,
  instituteOgPath,
} from "./paths.js";
import { CourseManifestSchema } from "./schema.js";
import { InstituteContent } from "./service.js";

export const instituteArtifactPin = {
  sha: "ad383c832586b4d406d7495406a3c26f81fddc20",
  digest: "cdba47941165c10e350040543124e86159a359a8622afb709e5e066096bb42ad",
};

export const instituteArtifactConfig = "INSTITUTE_CONTENT_ARTIFACT";

const chapterOrder = [
  "one-contract",
  "one-boundary",
  "effect-hard-parts",
  "who-owns-state",
  "cloud-as-code",
  "the-fence",
];

class InstituteArtifactError extends Schema.TaggedError<InstituteArtifactError>()(
  "InstituteArtifactError",
  {
    directory: Schema.String,
    reason: Schema.String,
  }
) {
  override get message() {
    return `Invalid Institute artifact ${this.directory}: ${this.reason}. Fix: set ${instituteArtifactConfig} from \`institute-artifact.sh path ${instituteArtifactPin.sha}\` and rebuild.`;
  }
}

const verifyArtifact = Effect.fn("Institute.verifyArtifact")(
  function* verifyArtifact(directory: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    if (!path.isAbsolute(directory)) {
      return yield* new InstituteArtifactError({
        directory,
        reason: "expected an absolute dist path",
      });
    }

    const digest = yield* Digest.Digest;
    const hashes: string[] = [];

    const paths = (yield* fs.readDirectory(directory, {
      recursive: true,
    })).toSorted();

    for (const entry of paths) {
      if (
        entry === "server/wrangler.json" ||
        entry.startsWith("server/.wrangler/")
      ) {
        continue;
      }

      const fullPath = path.join(directory, entry);
      const stat = yield* fs.stat(fullPath);

      if (stat.type === "File") {
        const bytes = yield* fs.readFile(fullPath);
        const hash = yield* digest.digestHex(Digest.sha256, bytes);
        hashes.push(`${hash}  ./${entry}\n`);
      }
    }

    const actual = yield* digest.digestHex(
      Digest.sha256,
      new TextEncoder().encode(hashes.join(""))
    );

    if (actual !== instituteArtifactPin.digest) {
      return yield* new InstituteArtifactError({
        directory,
        reason: `expected digest ${instituteArtifactPin.digest}, got ${actual}`,
      });
    }

    return actual;
  }
);

export const stageInstituteAssets = Effect.fn("Institute.stageAssets")(
  function* stageInstituteAssets(clientDirectory: string) {
    const configured = yield* Config.option(
      Config.String(instituteArtifactConfig)
    );

    if (Option.isNone(configured) || configured.value === "") {
      return;
    }

    const directory = configured.value;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* verifyArtifact(directory).pipe(
      Effect.catchTag(
        "PlatformError",
        (error) =>
          new InstituteArtifactError({ directory, reason: error.message })
      )
    );

    const fromAsset = (asset: string) => path.join(directory, "client", asset);

    const readAsset = (asset: string) =>
      fs
        .readFileString(fromAsset(asset))
        .pipe(
          Effect.mapError(
            (cause) => new InstituteAssetError({ path: asset, cause })
          )
        );

    const upstream = yield* InstituteContent.make(readAsset);
    const course = yield* upstream.manifest;
    const files = [instituteOgPath];

    const chapters = yield* Effect.forEach((chapterId: string, index) =>
      Effect.gen(function* stageChapter() {
        const metadata = course.chapters.find(({ id }) => id === chapterId);

        if (
          metadata === undefined ||
          metadata.draft === true ||
          metadata.comingSoon === true
        ) {
          return yield* new InstituteArtifactError({
            directory,
            reason: `chapter ${chapterId} is not published`,
          });
        }

        const chapter = yield* upstream.chapter(chapterId);

        if (chapter.sections.length === 0 || chapter.draft === true) {
          return yield* new InstituteArtifactError({
            directory,
            reason: `chapter ${chapterId} has no published sections`,
          });
        }

        const chapterFiles = yield* Effect.forEach(
          (entry: (typeof chapter.sections)[number]) =>
            Effect.gen(function* stageSection() {
              const section = yield* upstream.section(chapterId, entry.id);

              const urls = [
                chapterAssetPath(chapterId, entry.file),
                audioUrl(chapterId, section),
                audioFallbackUrl(chapterId, section),
              ].filter((asset) => asset !== undefined);

              for (const asset of urls) {
                const info = yield* fs
                  .stat(fromAsset(asset))
                  .pipe(
                    Effect.mapError(
                      (cause) => new InstituteAssetError({ path: asset, cause })
                    )
                  );

                if (
                  info.type !== "File" ||
                  info.size === 0n ||
                  info.size > 25n * 1024n * 1024n
                ) {
                  return yield* new InstituteArtifactError({
                    directory,
                    reason: `asset ${asset} must be a nonempty file within the 25 MiB static asset limit`,
                  });
                }
              }

              return urls;
            })
        )(chapter.sections);

        files.push(
          chapterAssetPath(chapterId, "manifest.json"),
          ...chapterFiles.flat()
        );

        return {
          ...metadata,
          order: index + 1,
          sectionsCount: chapter.sections.length,
        };
      })
    )(chapterOrder);

    for (const asset of files) {
      const output = path.join(clientDirectory, asset);
      yield* fs.makeDirectory(path.dirname(output), { recursive: true });
      yield* fs
        .copyFile(fromAsset(asset), output)
        .pipe(
          Effect.mapError(
            (cause) => new InstituteAssetError({ path: asset, cause })
          )
        );
    }

    const manifest = yield* Schema.encodeEffect(
      Schema.fromJsonString(CourseManifestSchema)
    )({ chapters });

    yield* fs.writeFileString(
      path.join(clientDirectory, instituteManifestPath),
      manifest
    );
  }
);
