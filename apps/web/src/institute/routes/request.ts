import { Effect } from "effect";

import type { EffectUiAssets } from "../../server/reader-document.js";
import { artifactReader } from "./artifact.js";
import type { AssetFetch } from "./artifact.js";
import { serveHashedAsset } from "./media.js";
import type { InstituteProps } from "./model.js";
import {
  chapterIdFrom,
  chapterPath,
  contentAssetChapter,
  instituteCreditsPath,
  instituteOrigin,
  institutePath,
  instituteSitemapPath,
  isKitChapter,
  ogPath,
} from "./paths.js";
import { renderInstitute } from "./render.js";

const sitemap = (chapters: readonly { readonly id: string }[]) => {
  const urls = [
    institutePath,
    ...chapters.map((chapter) => chapterPath(chapter.id)),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((path) => `  <url><loc>${instituteOrigin}${path}</loc></url>`).join("\n")}\n</urlset>\n`;
};

const sectionLink = ({ id }: { readonly id: string }) => ({
  id,
  title: id.charAt(0).toUpperCase() + id.slice(1).replaceAll("-", " "),
});

const chapterPage = Effect.fn("institute.chapterPage")(function* chapterPage(
  reader: ReturnType<typeof artifactReader>,
  chapter: Extract<InstituteProps, { readonly kind: "chapter" }>["chapter"],
  sectionId: string | null
) {
  const manifest = yield* reader.chapter(chapter.id);

  const selected = manifest.sections.findIndex(
    (section) => section.id === sectionId
  );

  const index = Math.max(0, selected);
  const entry = manifest.sections[index];

  if (manifest.id !== chapter.id || entry === undefined) {
    return null;
  }

  const section = yield* reader.section(chapter.id, entry.file);

  if (section.id !== entry.id) {
    return null;
  }

  const next = manifest.sections[index + 1];
  const previous = manifest.sections[index - 1];

  return {
    chapter,
    kind: "chapter",
    section: sectionLink(entry),
    sectionUrl: `${institutePath}/content/${chapter.id}/${entry.file}`,
    sections: manifest.sections.map(sectionLink),
    text: section.text,
    audioUrl:
      section.audioFile === undefined
        ? undefined
        : `${institutePath}/content/${chapter.id}/${section.audioFile}`,
    next: next === undefined ? undefined : sectionLink(next),
    previous: previous === undefined ? undefined : sectionLink(previous),
  } satisfies InstituteProps;
});

export const renderInstituteRequest = Effect.fn("institute.request")(
  function* renderInstituteRequest(
    request: Request,
    fetchAsset: AssetFetch,
    assets: typeof EffectUiAssets.Type,
    discoverable: boolean
  ) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/u, "");
    const chapterId = chapterIdFrom(path);
    const assetChapter = contentAssetChapter(path);

    if (path === instituteSitemapPath && !discoverable) {
      return null;
    }

    if (path === instituteCreditsPath) {
      return {
        application: yield* renderInstitute(
          { kind: "credits" },
          assets,
          discoverable
        ),
      };
    }

    if (path === ogPath) {
      return { response: yield* Effect.tryPromise(() => fetchAsset(request)) };
    }

    if (
      path !== institutePath &&
      path !== instituteSitemapPath &&
      (chapterId === undefined || isKitChapter(chapterId)) &&
      (assetChapter === undefined || isKitChapter(assetChapter))
    ) {
      return null;
    }

    const reader = artifactReader(fetchAsset, url.origin);
    const chapters = yield* reader.manifest;

    if (path === instituteSitemapPath) {
      return {
        response: new Response(
          request.method === "HEAD" ? null : sitemap(chapters),
          {
            headers: { "Content-Type": "application/xml; charset=utf-8" },
          }
        ),
      };
    }

    if (path === institutePath) {
      return {
        application: yield* renderInstitute(
          { chapters, kind: "home" },
          assets,
          discoverable
        ),
      };
    }

    if (assetChapter !== undefined) {
      return chapters.some((chapter) => chapter.id === assetChapter)
        ? {
            response: yield* serveHashedAsset(
              request,
              fetchAsset,
              discoverable
            ),
          }
        : null;
    }

    const chapter = chapters.find((item) => item.id === chapterId);

    if (chapter === undefined) {
      return null;
    }

    const props = yield* chapterPage(
      reader,
      chapter,
      url.searchParams.get("section")
    );

    return props === null
      ? null
      : { application: yield* renderInstitute(props, assets, discoverable) };
  }
);
