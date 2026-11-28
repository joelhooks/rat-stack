import { Option, Schema } from "effect";

import { Rate } from "./transport.js";

const prefix = "ratstack-institute:";

const SectionProgressSchema = Schema.Struct({
  completed: Schema.Boolean,
  positionMs: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type SectionProgress = typeof SectionProgressSchema.Type;

const ProgressJson = Schema.fromJsonString(SectionProgressSchema);

const PreferencesSchema = Schema.Struct({ muted: Schema.Boolean, rate: Rate });

export type Preferences = typeof PreferencesSchema.Type;

const PreferencesJson = Schema.fromJsonString(PreferencesSchema);

const sectionKey = (chapterId: string, sectionId: string) =>
  `${prefix}section:${encodeURIComponent(chapterId)}:${encodeURIComponent(sectionId)}`;

const preferencesKey = `${prefix}player-preferences`;

const read = (doc: Document, key: string) => {
  try {
    return doc.defaultView?.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (doc: Document, key: string, value: string) => {
  try {
    doc.defaultView?.localStorage.setItem(key, value);
  } catch {
    return false;
  }

  return true;
};

export const readSectionProgress = (
  doc: Document,
  chapterId: string,
  sectionId: string
): SectionProgress =>
  Option.getOrElse(
    Schema.decodeUnknownOption(ProgressJson)(
      read(doc, sectionKey(chapterId, sectionId))
    ),
    () => ({ completed: false, positionMs: 0 })
  );

export const saveSectionProgress = (
  doc: Document,
  chapterId: string,
  sectionId: string,
  progress: SectionProgress
) => {
  const persisted = readSectionProgress(doc, chapterId, sectionId);

  const encoded = Schema.encodeOption(ProgressJson)({
    completed: persisted.completed || progress.completed,
    positionMs: progress.positionMs,
  });

  if (Option.isSome(encoded)) {
    write(doc, sectionKey(chapterId, sectionId), encoded.value);
  }
};

export const readPreferences = (doc: Document): Preferences =>
  Option.getOrElse(
    Schema.decodeUnknownOption(PreferencesJson)(read(doc, preferencesKey)),
    () => ({ muted: false, rate: 1 })
  );

export const savePreferences = (doc: Document, value: Preferences) => {
  const encoded = Schema.encodeOption(PreferencesJson)(value);

  if (Option.isSome(encoded)) {
    write(doc, preferencesKey, encoded.value);
  }
};
