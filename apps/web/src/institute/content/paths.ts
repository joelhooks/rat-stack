import type { Section } from "./schema.js";

export const instituteContentPath = "/institute/content";

export const instituteManifestPath = `${instituteContentPath}/manifest.json`;

export const instituteOgPath = "/institute/og/home.png";

export const chapterAssetPath = (chapterId: string, file: string): string =>
  `${instituteContentPath}/${encodeURIComponent(chapterId)}/${file}`;

export const audioUrl = (
  chapterId: string,
  section: Section
): string | undefined =>
  section.audioFile === undefined
    ? undefined
    : chapterAssetPath(chapterId, section.audioFile);
