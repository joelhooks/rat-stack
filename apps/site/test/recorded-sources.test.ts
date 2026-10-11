import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { bibliographySourceSchema } from "../scripts/component-data.ts";
import { parseLorePage, renderBibliography } from "../scripts/content-lib.ts";
import { parseContentMarkdown, visitContentNodes } from "../scripts/svx-ast.ts";

const entries = Arbitrary.array(
  Arbitrary.schema(
    Schema.Struct({
      kind: Schema.Literals(["linked", "recording"]),
      token: Schema.String.check(Schema.isPattern(/^[a-z]{1,12}$/u)),
    })
  ),
  { maxLength: 15 }
);

it.prop(
  "linked sources retain every URL and recordings never become links",
  { entries },
  ({ entries: generated }) => {
    const sources = generated.map(({ kind, token }, index) =>
      kind === "linked"
        ? {
            accessed: "2026-10-07",
            kind,
            note: "Supports the claim.",
            publisher: "Public source",
            title: `Linked ${index} ${token}`,
            url: `https://example.com/${index}/${token}`,
          }
        : {
            kind,
            note: "Recorded conversation; quoted with permission",
            recordedAt: "2026-10-05",
            title: `Recorded ${index} ${token}`,
          }
    );

    const raw = `---\ntitle: Source fixture\ndescription: Sources retain their provenance.\ngroup: idea\nterms: [provenance]\nsources: ${JSON.stringify(sources)}\n---\n`;
    const page = parseLorePage(".brain/resources/lore/source-fixture.svx", raw);

    const linked = sources.flatMap((source) =>
      source.kind === "linked" ? [source] : []
    );

    const rendered = renderBibliography(page.bibliography);
    const links: { title: string; url: string }[] = [];

    visitContentNodes(parseContentMarkdown(rendered.markdown), (node) => {
      if (node.type === "link") {
        links.push({
          title: node.children
            .map((child) => (child.type === "text" ? child.value : ""))
            .join(""),
          url: node.url,
        });
      }
    });

    expect(page.sources).toStrictEqual(linked.map((source) => source.url));
    expect(links).toStrictEqual(
      linked.map(({ title, url }) => ({ title, url }))
    );
    expect(rendered.html.match(/<a /gu)?.length ?? 0).toBe(linked.length);

    for (const source of sources) {
      if (source.kind === "recording") {
        expect(rendered.html).toContain(
          `${source.title}. Recorded ${source.recordedAt}.`
        );
        expect(rendered.markdown).toContain(source.title);
      } else {
        expect(rendered.html).toContain(`href="${source.url}"`);
      }
    }
  }
);

it("rejects absent linked URLs, unknown kinds, and recording link fields", () => {
  const decode = Schema.decodeUnknownSync(bibliographySourceSchema, {
    onExcessProperty: "error",
  });

  const linked = {
    accessed: "2026-10-07",
    note: "Supports the claim.",
    publisher: "Public source",
    title: "Linked source",
    url: "https://example.com/source",
  };

  expect(decode(linked).kind).toBe("linked");
  expect(() => decode({ ...linked, url: undefined })).toThrow();
  expect(() => decode({ ...linked, kind: "unknown" })).toThrow();
  expect(() =>
    decode({
      kind: "recording",
      note: "Approved",
      recordedAt: "2026-10-05",
      title: "Recording",
      url: linked.url,
    })
  ).toThrow();
});
