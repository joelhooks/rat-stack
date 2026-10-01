import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { Arbitrary } from "effect/unstable/arbitrary";

import { canonicalMarkdownLinks } from "../src/markdown-links.js";

const filename = Arbitrary.array(
  Arbitrary.schema(Schema.Literals(["a", "b", "-", "0"])),
  { maxLength: 12, minLength: 1 }
).pipe(Arbitrary.map((characters) => `${characters.join("")}.svx`));

it.prop(
  "resource links retain their destination when bundled at the root",
  {
    file: filename,
    suffix: Schema.Literals(["", "#section", "?view=agent#section"]),
  },
  ({ file, suffix }) => {
    const target = `./${file}${suffix}`;
    const canonical = `/resources/${file}${suffix}`;

    const input = `[page](${target})\n[angle](<${target}>)\n[ref]: ${target}\n`;

    const result = canonicalMarkdownLinks(
      input,
      "/resources/study.svx",
      "https://ratstack.sh"
    );

    expect(result).toBe(
      `[page](${canonical})\n[angle](<${canonical}>)\n[ref]: ${canonical}\n`
    );
  }
);

it.prop(
  "bundling leaves code examples and external destinations alone",
  { file: filename },
  ({ file }) => {
    const input = `\`[page](./${file})\`\n\`\`\`md\n[page](./${file})\n\`\`\`\n[external](https://example.test/${file})`;

    expect(
      canonicalMarkdownLinks(
        input,
        "/resources/study.svx",
        "https://ratstack.sh"
      )
    ).toBe(input);
  }
);
