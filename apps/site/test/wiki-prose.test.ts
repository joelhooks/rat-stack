import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  wikiProseWarnings,
  wikiProseWarningText,
} from "../scripts/wiki-prose.ts";

const longSentence = `${Array.from({ length: 26 }, () => "word").join(" ")}.`;

const forbiddenForm = Arbitrary.schema(
  Schema.Literals([
    "previously",
    "used to",
    "no longer",
    "formerly",
    "for now",
    "will be replaced",
    "X, not Y",
    "not X, but Y",
    "—",
  ])
);

const proseWord = Arbitrary.array(
  Arbitrary.schema(Schema.Literals(["a", "b", "c", "🐀"])),
  { maxLength: 8, minLength: 1 }
).pipe(Arbitrary.map((letters) => letters.join("")));

const blankLineCount = Arbitrary.array(proseWord, { maxLength: 8 });

it.prop(
  "forbidden forms in generated prose produce a located warning",
  {
    blankLines: blankLineCount,
    form: forbiddenForm,
    prefix: proseWord,
    suffix: proseWord,
    upper: Arbitrary.schema(Schema.Boolean),
  },
  ({ form, prefix, suffix, blankLines, upper }) => {
    const text = `${prefix} ${upper ? form.toUpperCase() : form} ${suffix}.`;
    const source = `${blankLines.map(() => "").join("\n")}${blankLines.length > 0 ? "\n" : ""}${text}`;
    const warnings = wikiProseWarnings("generated.svx", source);
    expect(warnings.length).toBeGreaterThan(0);

    for (const warning of warnings) {
      expect(warning.file).toBe("generated.svx");
      expect(warning.line).toBe(blankLines.length + 1);
      expect(wikiProseWarningText(warning)).toContain(
        `generated.svx:${blankLines.length + 1}: wiki prose:`
      );
    }
  }
);

it.prop(
  "quotes, code and links protect every generated forbidden form",
  {
    form: forbiddenForm,
    prefix: proseWord,
    suffix: proseWord,
    wrapper: Arbitrary.schema(
      Schema.Literals([
        "double",
        "curlyDouble",
        "single",
        "curlySingle",
        "inline",
        "fenced",
        "blockquote",
        "link",
        "reference",
      ])
    ),
  },
  ({ form, prefix, suffix, wrapper }) => {
    const prose = `${prefix} ${form} ${suffix}`;

    const wrappers = {
      blockquote: `> ${prose}`,
      curlyDouble: `“${prose}”`,
      curlySingle: `‘${prose}’`,
      double: `"${prose}"`,
      fenced: `~~~text\n${prose}\n~~~`,
      inline: `\`${prose}\``,
      link: `[${prose}](https://example.test/previously)`,
      reference: `[${prose}][ref]\n\n[ref]: https://example.test/previously`,
      single: `'${prose}'`,
    };

    expect(wikiProseWarnings("generated.svx", wrappers[wrapper])).toEqual([]);
  }
);

it.prop(
  "formatted quoted prose stays quiet without hiding later prose",
  { form: forbiddenForm },
  ({ form }) => {
    const source = `“🐀 **${form}**”\n\n🐀 **${form}**.`;
    const warnings = wikiProseWarnings("formatted.svx", source);

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((warning) => warning.line === 3)).toBe(true);
  }
);

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
