import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { compileReaderDocument } from "../scripts/reader-home-document.ts";

const word = Arbitrary.array(
  Arbitrary.schema(Schema.Literals(["a", "b", "c", "d"])),
  { maxLength: 30, minLength: 1 }
).pipe(Arbitrary.map((letters) => letters.join("")));

const page = { heading: "Rat Stack", route: "/" };

it.prop(
  "human readers retain human content and never receive agent content",
  { human: word, secret: word, nested: Arbitrary.schema(Schema.Boolean) },
  ({ human, secret, nested }) => {
    const hidden = nested ? `<HumanOnly>\n\n${secret}\n\n</HumanOnly>` : secret;
    const source = `# Rat Stack\n\n<HumanOnly>\n\n${human}\n\n<AgentOnly>\n\n${hidden}\n\n</AgentOnly>\n\n</HumanOnly>\n\nVisible after.`;
    const document = compileReaderDocument(source, [], page);

    expect(document).toEqual(
      compileReaderDocument(
        `# Rat Stack\n\n${human}\n\nVisible after.`,
        [],
        page
      )
    );
  }
);

it.prop(
  "unknown components still fail inside human content",
  { name: word },
  ({ name }) => {
    expect(() =>
      compileReaderDocument(
        `# Rat Stack\n\n<HumanOnly>\n\n<Unknown${name} />\n\n</HumanOnly>`,
        [],
        page
      )
    ).toThrow("Unsupported home component");
  }
);

it.prop(
  "unbalanced audience wrappers fail instead of hiding later content",
  {
    text: word,
    audience: Arbitrary.schema(Schema.Literals(["HumanOnly", "AgentOnly"])),
  },
  ({ text, audience }) => {
    expect(() =>
      compileReaderDocument(`# Rat Stack\n\n<${audience}>\n\n${text}`, [], page)
    ).toThrow("Unclosed reader audience");
    expect(() =>
      compileReaderDocument(
        `# Rat Stack\n\n${text}\n\n</${audience}>`,
        [],
        page
      )
    ).toThrow("Mismatched reader audience");
  }
);
