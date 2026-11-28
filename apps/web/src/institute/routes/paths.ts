import { institutePath } from "../../../../site/src/institute-paths.js";

export {
  institutePath,
  instituteSitemapPath,
  isInstitutePath,
} from "../../../../site/src/institute-paths.js";

export const instituteCreditsPath = `${institutePath}/credits`;

export const instituteOrigin = "https://ratstack.sh";

export const instituteOriginal = "https://www.effect.institute";

export const chapterPath = (chapter: string) =>
  `${institutePath}/chapters/${encodeURIComponent(chapter)}`;

export const sectionPath = (chapter: string, section: string) =>
  `${chapterPath(chapter)}?${new URLSearchParams({ section })}`;

export const chapterIdFrom = (path: string) =>
  /^\/institute\/chapters\/(?<id>[a-z0-9]+(?:-[a-z0-9]+)*)$/u.exec(path)?.groups
    ?.id;

export const isKitChapter = (chapter: string) =>
  chapter === "intro" || chapter === "basics";

export const ogPath = `${institutePath}/og/home.png`;

export const contentAssetChapter = (path: string) =>
  /^\/institute\/content\/(?<id>[a-z0-9-]+)\/[a-z0-9-]+\.[a-f0-9]{8}\.(?:json|webm|m4a)$/u.exec(
    path
  )?.groups?.id;
