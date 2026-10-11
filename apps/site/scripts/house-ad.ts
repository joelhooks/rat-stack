import { houseAdCopy } from "../src/house-ad-copy.ts";

export const hasHouseAd = (routePath: string) =>
  routePath === "/" || /^\/(?:lore|systems|skills)(?:\/|$)/u.test(routePath);

export const withHouseAdPointer = (markdown: string, routePath: string) => {
  if (!hasHouseAd(routePath)) {
    return markdown;
  }

  const pointer = `${houseAdCopy.label}: [${houseAdCopy.line}](${houseAdCopy.href}).`;

  return markdown.replace(/^(?<title># [^\n]+\n)/mu, `$<title>\n${pointer}\n`);
};
