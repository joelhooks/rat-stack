import { githubProfileUrl, xProfileUrl } from "@rat-stack/core/contracts";
import type {
  CafeNewsItemValue,
  CafeNewsList,
} from "@rat-stack/core/contracts";

const xmlEscapes = new Map([
  ['"', "&quot;"],
  ["&", "&amp;"],
  ["'", "&apos;"],
  ["<", "&lt;"],
  [">", "&gt;"],
]);

const xmlText = (value: string) =>
  value.replaceAll(
    /["&'<>]/gu,
    (character) => xmlEscapes.get(character) ?? character
  );

const atomDate = (date: string) => `${date}T00:00:00Z`;

const authorName = (item: CafeNewsItemValue) =>
  item.author.x ?? item.author.github ?? new URL(item.url).hostname;

const authorUri = (item: CafeNewsItemValue) => {
  if (item.author.github !== null) {
    return githubProfileUrl(item.author.github);
  }

  return item.author.x === null ? undefined : xProfileUrl(item.author.x);
};

const entryXml = (item: CafeNewsItemValue) => {
  const uri = authorUri(item);

  return [
    "  <entry>",
    `    <title>${xmlText(item.title)}</title>`,
    `    <link href="${xmlText(item.url)}"/>`,
    `    <id>${xmlText(item.url)}</id>`,
    `    <updated>${atomDate(item.date)}</updated>`,
    ...(item.summary === null
      ? []
      : [`    <summary>${xmlText(item.summary)}</summary>`]),
    `    <category term="${item.kind}"/>`,
    `    <author><name>${xmlText(authorName(item))}</name>${uri === undefined ? "" : `<uri>${xmlText(uri)}</uri>`}</author>`,
    "  </entry>",
  ].join("\n");
};

export const cafeAtomFeed = (
  origin: string,
  list: typeof CafeNewsList.Type
) => `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>CAFE news</title>
  <subtitle>Reviewed news from people who build with Cloudflare, Alchemy, Foldkit and Effect.</subtitle>
  <link rel="self" href="${xmlText(origin)}/news.xml"/>
  <link rel="alternate" href="${xmlText(origin)}/news"/>
  <id>${xmlText(origin)}/news</id>
  <updated>${atomDate(list.rankedAt)}</updated>
${list.items.map((entry) => entryXml(entry.item)).join("\n")}
</feed>
`;
