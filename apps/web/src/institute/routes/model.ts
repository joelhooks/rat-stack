import { Schema } from "effect";

import { effectUiHandoff } from "../../client/effect-ui-handoff.js";

const ChapterLink = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
});

const SectionLink = Schema.Struct({ id: Schema.String, title: Schema.String });

export const InstitutePageProps = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("credits") }),
  Schema.Struct({
    kind: Schema.Literal("home"),
    chapters: Schema.Array(ChapterLink),
  }),
  Schema.Struct({
    kind: Schema.Literal("chapter"),
    chapter: ChapterLink,
    section: SectionLink,
    sectionUrl: Schema.String,
    sections: Schema.Array(SectionLink),
    text: Schema.String,
    audioUrl: Schema.optional(Schema.String),
    audioFallbackUrl: Schema.optional(Schema.String),
    nextChapter: Schema.optional(ChapterLink),
    next: Schema.optional(SectionLink),
    previous: Schema.optional(SectionLink),
  }),
]);

export type InstituteProps = typeof InstitutePageProps.Type;

export const InstituteHandoff = effectUiHandoff(InstitutePageProps);

export const instituteRootId = "institute-effect-ui";

export const instituteHandoffId = "institute-effect-ui-handoff";

export const institutePlayerId = "institute-player";

export const instituteTitle = "Ratstack Institute";

export const instituteDescription =
  "Learn how rat-stack puts Effect, Alchemy, and the fence to work.";
