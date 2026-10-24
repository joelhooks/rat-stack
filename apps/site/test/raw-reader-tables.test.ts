import { expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { rawReaderTables } from "../scripts/raw-reader-tables.ts";

it.prop(
  "finds raw table rows through inline markup and ignores code and attributes",
  {
    cell: Schema.Literals(["capability", "Better Auth", "request analytics"]),
    newline: Schema.Literals(["\n", " "]),
    wrapper: Schema.Literals(["p", "li", "div"]),
  },
  ({ cell, wrapper, newline }) => {
    const row = `| <strong>${cell}</strong> | <a href="/">Job</a> |`;
    const html = `<main>\n<${wrapper}>${row}${newline}| --- | --- |</${wrapper}>\n<pre><code>${row}</code></pre><code>| inline | code |</code><p title="| attribute | value |">Prose</p></main>`;
    const findings = rawReaderTables(html);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.map((finding) => finding.line)).toEqual(
      newline === "\n" ? [2, 3] : [2]
    );
    expect(findings.map((finding) => finding.text).join("\n")).toContain(cell);
    expect(rawReaderTables(`<pre>${row}</pre><code>${row}</code>`)).toEqual([]);
    expect(
      rawReaderTables('<p title="| a | b |">Ordinary prose with a | b.</p>')
    ).toEqual([]);
  }
);

it("reports separator fragments even when a renderer collapses lines", () => {
  expect(rawReaderTables("<p>Intro | --- | --- | end</p>")).toEqual([
    { line: 1, text: "Intro | --- | --- | end" },
  ]);
});
