import type { CafeProfileValue } from "@rat-stack/core/contracts";

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

interface FeedEntry {
  readonly author: string;
  readonly category: string;
  readonly date: string;
  readonly summary: string | null;
  readonly title: string;
  readonly url: string;
}

const entryXml = (entry: FeedEntry) =>
  [
    "  <entry>",
    `    <title>${xmlText(entry.title)}</title>`,
    `    <link href="${xmlText(entry.url)}"/>`,
    `    <id>${xmlText(entry.url)}</id>`,
    `    <updated>${entry.date}T00:00:00Z</updated>`,
    ...(entry.summary === null
      ? []
      : [`    <summary>${xmlText(entry.summary)}</summary>`]),
    `    <category term="${entry.category}"/>`,
    `    <author><name>${xmlText(entry.author)}</name></author>`,
    "  </entry>",
  ].join("\n");

const profileEntries = (
  origin: string,
  profile: CafeProfileValue
): readonly FeedEntry[] => [
  {
    author: profile.name,
    category: profile.kind,
    date: profile.updated,
    summary: profile.bio[0].text,
    title: `${profile.name} on CAFE all stars`,
    url: `${origin}${profile.route}`,
  },
  ...profile.newsRows.map((item) => ({
    author: profile.name,
    category: item.kind,
    date: item.date,
    summary: item.summary,
    title: item.title,
    url: item.url,
  })),
  ...profile.videos.map((video) => ({
    author: profile.name,
    category: "video",
    date: video.date,
    summary: null,
    title: video.title,
    url: video.url,
  })),
];

export const allStarsAtomFeed = (
  origin: string,
  profiles: readonly CafeProfileValue[]
) => {
  const entries = profiles
    .flatMap((profile) => profileEntries(origin, profile))
    .toSorted((left, right) => right.date.localeCompare(left.date));

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>CAFE all stars</title>
  <link rel="self" href="${xmlText(origin)}/all-stars.xml"/>
  <link rel="alternate" href="${xmlText(origin)}/all-stars"/>
  <id>${xmlText(origin)}/all-stars</id>
  <updated>${entries[0]?.date ?? "1970-01-01"}T00:00:00Z</updated>
${entries.map(entryXml).join("\n")}
</feed>
`;
};
