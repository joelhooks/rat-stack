import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { glossaryFirstUseWarnings } from "../scripts/glossary-first-use.ts";

const glossaryTerm = Arbitrary.array(
  Arbitrary.schema(Schema.Literals(["a", "b", "c", "d"])),
  { maxLength: 12, minLength: 3 }
).pipe(Arbitrary.map((letters) => letters.join("")));

it.prop(
  "a later definition or link cannot excuse an unexplained first mention",
  { term: glossaryTerm, upper: Arbitrary.schema(Schema.Boolean) },
  ({ term, upper }) => {
    const mention = upper ? term.toUpperCase() : term;
    const entries = [{ routePath: "/glossary", summary: "A job", term }];
    const source = `Use ${mention} here.\n\n[${term}](/glossary) is a job.`;
    expect(glossaryFirstUseWarnings("page.md", source, entries)).toEqual([
      { file: "page.md", line: 1, target: "/glossary", term },
    ]);
  }
);

it.prop(
  "definitions and links at first use keep later mentions quiet",
  {
    form: Arbitrary.schema(
      Schema.Literals(["is", "means", "colon", "link", "reference"])
    ),
    term: glossaryTerm,
  },
  ({ term, form }) => {
    const first = {
      colon: `**${term}**: a job.`,
      is: `A **${term}** is a job.`,
      link: `[${term}](/glossary) does a job.`,
      means: `${term} means a job.`,
      reference: `[${term}][definition] does a job.\n\n[definition]: /glossary`,
    };

    expect(
      glossaryFirstUseWarnings("page.md", `${first[form]}\n\nUse ${term}.`, [
        { routePath: "/glossary", summary: "A job", term },
      ])
    ).toEqual([]);
  }
);

it.prop(
  "code, quotes, headings, tables and word fragments do not consume first use",
  { term: glossaryTerm },
  ({ term }) => {
    const source = `# ${term}\n\n> ${term}\n\n\`${term}\`\n\n~~~text\n${term}\n~~~\n\n| Term |\n| --- |\n| ${term} |\n\nx${term}x\n\nUse ${term}.`;

    const warnings = glossaryFirstUseWarnings("page.md", source, [
      { routePath: "/glossary", summary: "A job", term },
    ]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.line).toBe(source.split("\n").length);
  }
);

it("matches punctuation literally and does not let a later link hide a mention in the same paragraph", () => {
  expect(
    glossaryFirstUseWarnings("page.md", "Use a+b, then [a+b](/glossary).", [
      { routePath: "/glossary", summary: "A job", term: "a+b" },
    ])
  ).toEqual([{ file: "page.md", line: 1, target: "/glossary", term: "a+b" }]);
});
