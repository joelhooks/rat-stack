import { Schema } from "effect";

import { AnimationSoundName, CodeSlideshow } from "./slideshow.js";

const Id = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u));

const SectionFile = Schema.String.check(
  Schema.isPattern(/^[a-z0-9-]+\.[0-9a-f]{8}\.json$/u)
);

export const AudioFile = Schema.String.check(
  Schema.isPattern(/^[a-z0-9-]+\.[0-9a-f]{8}\.webm$/u)
);

export const CourseManifestSchema = Schema.Struct({
  chapters: Schema.Array(
    Schema.Struct({
      id: Id,
      title: Schema.String,
      description: Schema.optionalKey(Schema.String),
      order: Schema.Finite,
      draft: Schema.optionalKey(Schema.Boolean),
      comingSoon: Schema.optionalKey(Schema.Boolean),
      sectionsCount: Schema.optionalKey(Schema.Finite),
    })
  ),
});

export type CourseManifest = typeof CourseManifestSchema.Type;

export const ChapterManifestSchema = Schema.Struct({
  id: Id,
  title: Schema.String,
  description: Schema.optionalKey(Schema.String),
  sections: Schema.Array(Schema.Struct({ id: Id, file: SectionFile })),
  groups: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Id,
        title: Schema.String,
        sectionIds: Schema.Array(Id),
      })
    )
  ),
  draft: Schema.optionalKey(Schema.Boolean),
  draftGroups: Schema.optionalKey(Schema.Array(Id)),
});

export type ChapterManifest = typeof ChapterManifestSchema.Type;

const WordTiming = Schema.Struct({
  word: Schema.String,
  start: Schema.Finite,
  end: Schema.Finite,
  style: Schema.optionalKey(
    Schema.Struct({
      bold: Schema.optionalKey(Schema.Boolean),
      italic: Schema.optionalKey(Schema.Boolean),
      code: Schema.optionalKey(Schema.Boolean),
    })
  ),
  paragraphBreak: Schema.optionalKey(Schema.Boolean),
  listItem: Schema.optionalKey(Schema.Boolean),
  definition: Schema.optionalKey(Schema.String),
  link: Schema.optionalKey(Schema.String),
  suffix: Schema.optionalKey(Schema.String),
});

const Step = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  at: Schema.String,
  nth: Schema.optionalKey(Schema.Finite),
  after: Schema.optionalKey(Schema.String),
  offset: Schema.optionalKey(Schema.Finite),
});

export const SectionSchema = Schema.Struct({
  id: Id,
  text: Schema.String,
  code: Schema.String,
  contentHash: Schema.String,
  wordTimings: Schema.Array(WordTiming),
  componentFlow: Schema.optionalKey(
    Schema.Struct({
      name: Schema.String,
      steps: Schema.Array(Step),
      snapshots: Schema.Array(
        Schema.Struct({
          state: Schema.Record(Schema.String, Schema.Unknown),
          sound: Schema.optionalKey(AnimationSoundName),
        })
      ),
    })
  ),
  slideshowData: Schema.optionalKey(CodeSlideshow),
  steps: Schema.optionalKey(Schema.Array(Step)),
  stepTimes: Schema.optionalKey(Schema.Array(Schema.Finite)),
  componentStepTimes: Schema.optionalKey(Schema.Array(Schema.Finite)),
  _debug: Schema.optionalKey(
    Schema.Struct({
      timingsStatus: Schema.Literals(["none", "matched", "mismatched"]),
      dslWordCount: Schema.Finite,
      message: Schema.optionalKey(Schema.String),
    })
  ),
  groupId: Schema.optionalKey(Id),
  groupTitle: Schema.optionalKey(Schema.String),
  isFirstInGroup: Schema.optionalKey(Schema.Boolean),
  groupDraft: Schema.optionalKey(Schema.Boolean),
  audioFile: Schema.optionalKey(AudioFile),
});

export type Section = typeof SectionSchema.Type;
