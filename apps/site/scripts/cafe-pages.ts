import {
  cafeDomain,
  cafeLetterInitial,
  githubProfileUrl,
  selectCafeNews,
  sortCafeProjects,
  verifiedLetters,
  xProfileUrl,
} from "@rat-stack/core/contracts";
import type {
  CafeAuthor,
  CafeDataValue,
  CafeNewsItemValue,
  CafeProjectValue,
} from "@rat-stack/core/contracts";

import {
  directoryCopy,
  letterNames,
  newsCopy,
  newsKindLabels,
  sortRules,
  sortRulesLead,
  sortSignals,
  sortSignalsLead,
  sortSources,
  threadCounts,
} from "../../web/src/features/cafe/copy.ts";

const pageLimit = 100;

const linkText = (value: string) => value.replaceAll(/[[\]]/gu, "");

const authorMarkdown = (author: typeof CafeAuthor.Type, fallback: string) => {
  if (author.github !== null) {
    return `[${linkText(author.github)}](${githubProfileUrl(author.github)})`;
  }

  if (author.x !== null) {
    return `[@${author.x}](${xProfileUrl(author.x)})`;
  }

  return fallback;
};

const threadMarkdown = (item: CafeNewsItemValue) =>
  item.kind === "thread"
    ? [
        `   ${threadCounts(item.engagement.replies, item.engagement.participants)}`,
        ...item.topReplies
          .slice(0, 3)
          .map(
            (reply) =>
              `   - [@${reply.x}](${xProfileUrl(reply.x)}): ${reply.text.replaceAll("\n", " ")} ([${reply.likes} likes](${reply.url}))`
          ),
      ]
    : [];

const newsItemMarkdown = (item: CafeNewsItemValue, index: number) =>
  [
    `${index + 1}. [${newsKindLabels[item.kind]}] [${linkText(item.title)}](${item.url}) (${cafeDomain(item.url)})`,
    ...(item.summary === null ? [] : [`   ${item.summary}`]),
    `   ${item.date} by ${authorMarkdown(item.author, cafeDomain(item.url))}`,
    ...threadMarkdown(item),
  ].join("\n");

export const cafeNewsMarkdown = (data: CafeDataValue) => {
  const list = selectCafeNews(data, { limit: pageLimit, sort: "rank" });

  return [
    `# ${newsCopy.heading}`,
    "",
    newsCopy.intro,
    "",
    `[${newsCopy.feedLabel}](/news.xml)`,
    "",
    list.items
      .map((entry, index) => newsItemMarkdown(entry.item, index))
      .join("\n\n"),
    "",
    `## ${newsCopy.sortHeading}`,
    "",
    sortSignalsLead,
    "",
    ...sortSignals.map((signal) => `- ${signal}`),
    "",
    sortRulesLead,
    "",
    ...sortRules.map((rule) => `- ${rule}`),
    "",
    `Prior art: ${sortSources.map((source) => `[${source.label}](${source.href})`).join(", ")}.`,
    "",
  ].join("\n");
};

const projectMarkdown = (project: CafeProjectValue) =>
  [
    `- [${linkText(project.title)}](${project.url}) ${verifiedLetters(project)
      .map((letter) => `\`${cafeLetterInitial[letter]}\``)
      .join(" ")}`,
    `  ${project.summary}`,
    `  by ${authorMarkdown(project.author, cafeDomain(project.url))} · updated ${project.date}${project.stars === null ? "" : ` · ${project.stars} stars`}`,
    ...verifiedLetters(project).map(
      (letter) => `  - ${letterNames[letter]}: ${project.stack[letter] ?? ""}`
    ),
  ].join("\n");

export const cafeDirectoryMarkdown = (data: CafeDataValue) =>
  [
    `# ${directoryCopy.heading}`,
    "",
    directoryCopy.intro,
    "",
    sortCafeProjects(data.projects, "updated").map(projectMarkdown).join("\n"),
    "",
  ].join("\n");
