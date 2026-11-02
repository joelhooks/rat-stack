import { sortCafeNewsNewest } from "@rat-stack/core/contracts";
import type { CafeNewsItemValue } from "@rat-stack/core/contracts";

import { escapeHtmlText } from "./document-html.ts";

export const newestNewsTitle = (news: readonly CafeNewsItemValue[]) =>
  sortCafeNewsNewest(news).at(0)?.title;

export const hasNewsCallout = (routePath: string) =>
  routePath === "/" || /^\/(?:lore|systems|skills)(?:\/|$)/u.test(routePath);

export const renderNewsCallout = (title: string | undefined) =>
  title === undefined
    ? ""
    : `<aside class="news-callout" aria-label="New on /news"><span>New on /news:</span> <a href="/news">${escapeHtmlText(title)}</a></aside>`;

export const withNewsPointer = (
  markdown: string,
  routePath: string,
  title: string | undefined
) => {
  if (!hasNewsCallout(routePath) || title === undefined) {
    return markdown;
  }

  const label = title.replaceAll(
    /(?<punctuation>[\\[\]])/gu,
    "\\$<punctuation>"
  );

  const pointer = `New on /news: [${label}](/news).`;

  return markdown.replace(
    /^(?<title># [^\n]+\n)/mu,
    (_, heading: string) => `${heading}\n${pointer}\n`
  );
};
