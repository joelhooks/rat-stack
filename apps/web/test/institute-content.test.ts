import { NodeCrypto, NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  Config,
  ConfigProvider,
  Effect,
  FileSystem,
  Option,
  Path,
  Schema,
} from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  instituteArtifactConfig,
  stageInstituteAssets,
} from "../src/institute/content/artifact.js";
import {
  audioFallbackUrl,
  audioUrl,
  InstituteAssetError,
  InstituteContent,
} from "../src/institute/content/index.js";
import {
  chapterAssetPath,
  instituteManifestPath,
  instituteOgPath,
} from "../src/institute/content/paths.js";

const chapterId = "chapter";

const hasAudio = Arbitrary.schema(Schema.Boolean);

const lessonNumber = Arbitrary.schema(
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThan(1000))
);

it.effect.prop(
  "resolves a manifest's hashed lesson, not arbitrary file names, and accepts no narration",
  { narrated: hasAudio, fallback: hasAudio, index: lessonNumber },
  ({ narrated, fallback, index }) =>
    Effect.gen(function* resolveLesson() {
      const id = `lesson-${index}`;
      const narration = `lesson-${index}.a982ba54.webm`;
      const alternate = `lesson-${index}.badf0151.m4a`;
      const file = `lesson-${index}.1234abcd.json`;

      const base = {
        id,
        text: "Start here.",
        code: "",
        contentHash: "0123456789abcdef",
        wordTimings: [{ word: "Start", start: 0, end: 0.25 }],
      };

      const primary = narrated ? { ...base, audioFile: narration } : base;

      const lesson =
        narrated && fallback
          ? { ...primary, audioFallbackFile: alternate }
          : primary;

      const assets = new Map([
        [
          instituteManifestPath,
          JSON.stringify({
            chapters: [{ id: chapterId, title: "Chapter", order: 1 }],
          }),
        ],
        [
          chapterAssetPath(chapterId, "manifest.json"),
          JSON.stringify({
            id: chapterId,
            title: "Chapter",
            sections: [{ id, file }],
          }),
        ],
        [chapterAssetPath(chapterId, file), JSON.stringify(lesson)],
      ]);

      const content = yield* InstituteContent.make((path) => {
        const document = assets.get(path);

        return document === undefined
          ? Effect.fail(
              new InstituteAssetError({ path, cause: "missing from fixture" })
            )
          : Effect.succeed(document);
      });

      const section = yield* content.section(chapterId, id);
      expect(section).toEqual(lesson);
      expect(audioUrl(chapterId, section)).toBe(
        narrated ? chapterAssetPath(chapterId, narration) : undefined
      );

      expect(audioFallbackUrl(chapterId, section)).toBe(
        narrated && fallback
          ? chapterAssetPath(chapterId, alternate)
          : undefined
      );

      const missingSection = yield* Effect.flip(
        content.section(chapterId, `${id}-other`)
      );

      expect(missingSection._tag).toBe("InstituteSectionNotFound");

      const missingChapter = yield* Effect.flip(
        content.section(`${chapterId}-other`, id)
      );

      expect(missingChapter._tag).toBe("InstituteChapterNotFound");
    })
);

it.effect(
  "leaves the Website output untouched with no artifact configured",
  () =>
    Effect.gen(function* emptyWebsite() {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      yield* stageInstituteAssets(directory).pipe(
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))
      );
      expect(yield* fs.readDirectory(directory)).toEqual([]);
    }).pipe(Effect.provide([NodeServices.layer, NodeCrypto.layerDigest]))
);

it.effect("rejects an unpinned artifact before emitting assets", () =>
  Effect.gen(function* unpinnedArtifact() {
    const fs = yield* FileSystem.FileSystem;
    const artifact = yield* fs.makeTempDirectoryScoped();
    const output = yield* fs.makeTempDirectoryScoped();

    const failure = yield* stageInstituteAssets(output).pipe(
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ [instituteArtifactConfig]: artifact })
        )
      ),
      Effect.flip
    );

    expect(failure._tag).toBe("InstituteArtifactError");
    expect(failure.message).toContain("expected digest");
    expect(yield* fs.readDirectory(output)).toEqual([]);
  }).pipe(Effect.provide([NodeServices.layer, NodeCrypto.layerDigest]))
);

it.effect(
  "stages and decodes every published rat-stack lesson when the pinned artifact is configured",
  () =>
    Effect.gen(function* pinnedWebsite() {
      const artifact = yield* Config.option(
        Config.String(instituteArtifactConfig)
      );

      if (Option.isNone(artifact) || artifact.value === "") {
        return;
      }

      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const output = yield* fs.makeTempDirectoryScoped();
      yield* stageInstituteAssets(output);

      const content = yield* InstituteContent.make((asset) =>
        fs
          .readFileString(path.join(output, asset))
          .pipe(
            Effect.mapError(
              (cause) => new InstituteAssetError({ path: asset, cause })
            )
          )
      );

      const course = yield* content.manifest;
      expect(course.chapters.map(({ id }) => id)).toEqual([
        "one-contract",
        "one-boundary",
        "effect-hard-parts",
        "who-owns-state",
        "cloud-as-code",
        "the-fence",
      ]);

      const expectedFallbacks: string[] = [];

      const assetCount = yield* Effect.forEach(
        ({ id: chapter }: (typeof course.chapters)[number]) =>
          Effect.gen(function* countLessons() {
            const manifest = yield* content.chapter(chapter);
            yield* Effect.forEach(
              ({ id, file }: (typeof manifest.sections)[number]) =>
                Effect.gen(function* checkNarration() {
                  const section = yield* content.section(chapter, id);
                  const audio = audioUrl(chapter, section);
                  expect(audio).toBeDefined();
                  expect(section.wordTimings.length).toBeGreaterThan(0);
                  expect(section._debug?.timingsStatus).toBe("matched");
                  const json = chapterAssetPath(chapter, file);
                  const fallback = audioFallbackUrl(chapter, section);
                  expect(fallback).toBeDefined();

                  if (fallback !== undefined) {
                    expectedFallbacks.push(fallback);
                  }

                  for (const asset of [json, audio, fallback].filter(
                    (url) => url !== undefined
                  )) {
                    const original = yield* fs.readFile(
                      path.join(artifact.value, "client", asset)
                    );

                    const staged = yield* fs.readFile(path.join(output, asset));
                    expect(staged).toEqual(original);
                  }
                })
            )(manifest.sections);

            return manifest.sections.length;
          })
      )(course.chapters);

      expect(assetCount).toEqual([4, 2, 4, 5, 2, 4]);
      expect(yield* fs.exists(path.join(output, instituteOgPath))).toBe(true);
      const emitted = yield* fs.readDirectory(output, { recursive: true });
      expect(emitted.filter((file) => file.endsWith(".json"))).toHaveLength(28);
      expect(emitted.filter((file) => file.endsWith(".webm"))).toHaveLength(21);
      expect(
        emitted
          .filter((file) => file.endsWith(".m4a"))
          .map((file) => `/${file}`)
          .toSorted()
      ).toEqual(expectedFallbacks.toSorted());
      expect(emitted.some((file) => file.endsWith(".js"))).toBe(false);
    }).pipe(Effect.provide([NodeServices.layer, NodeCrypto.layerDigest]))
);
