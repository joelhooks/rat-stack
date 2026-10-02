import { expect, it } from "@effect/vitest";

import {
  wikiProseWarnings,
  wikiProseWarningText,
} from "../scripts/wiki-prose.ts";

const longSentence = `${Array.from({ length: 26 }, () => "word").join(" ")}.`;

it("warns once for a long sentence and once for a long paragraph", () => {
  const source = [
    "---",
    "title: Fixture",
    "---",
    longSentence,
    "",
    "One sentence. Two sentences. Three sentences. Four sentences. Five sentences.",
  ].join("\n");

  const warnings = wikiProseWarnings("fixture.svx", source);

  expect(warnings).toEqual([
    { count: 26, file: "fixture.svx", kind: "sentence", limit: 25, line: 4 },
    { count: 5, file: "fixture.svx", kind: "paragraph", limit: 4, line: 6 },
  ]);
  expect(warnings.map(wikiProseWarningText)).toEqual([
    "fixture.svx:4: wiki prose: sentence has 26 words (aim ≤25)",
    "fixture.svx:6: wiki prose: paragraph has 5 sentences (aim ≤4)",
  ]);
});

it("keeps clean prose quiet and skips code, tables, quotes, and frontmatter", () => {
  const source = [
    "---",
    `description: ${longSentence}`,
    "---",
    "# A claim",
    "",
    "Use the same term.",
    "",
    "- Read the page.",
    "- Check the result.",
    "",
    `> ${longSentence}`,
    "",
    "~~~text",
    longSentence,
    "~~~",
    "",
    "| A |",
    "| --- |",
    `| ${longSentence} |`,
    "",
    `Run \`${longSentence}\` now.`,
    "",
    "`a`. `b`. `c`. `d`. `e`.",
  ].join("\n");

  expect(wikiProseWarnings("clean.svx", source)).toEqual([]);
});

it("counts linked and emphasized prose in list items", () => {
  const source = `- **${longSentence}** [Read the result](/lore/the-fence).`;

  expect(wikiProseWarnings("list.svx", source)).toEqual([
    { count: 26, file: "list.svx", kind: "sentence", limit: 25, line: 1 },
  ]);
});
