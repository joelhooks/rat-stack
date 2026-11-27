import { expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";

import { ReaderBlock, ReaderInline } from "../src/client/reader-document.js";
import { ReaderSource } from "../src/reader-cafe.js";
import { readerCodeWithoutPageData } from "./reader-bundle-data.js";

it.prop(
  "only the exact prepared ReaderFlags literal is exempt from executable-string checks",
  { page: Arbitrary.schema(ReaderSource) },
  ({ page }) => {
    const input = [
      {
        ...page,
        blocks: [
          ReaderBlock.Paragraph({
            content: [
              ReaderInline.Text({
                value:
                  "rat_call and rat_test_person are public documentation terms",
              }),
            ],
          }),
        ],
      },
    ];

    const prepared = Schema.decodeSync(
      Schema.fromJsonString(Schema.Array(ReaderSource))
    )(
      Schema.encodeSync(Schema.fromJsonString(Schema.Array(ReaderSource)))(
        input
      )
    );

    const sourcesOf = (pages: readonly (typeof prepared)[number][]) =>
      JSON.stringify(
        pages.map((document) => [
          document.page.path,
          Schema.encodeSync(Schema.fromJsonString(ReaderSource))(document),
        ])
      );

    const code = `const readerPageSources = ${sourcesOf(prepared)}; const rat_call = "rat_test_person";`;
    const runtime = readerCodeWithoutPageData(code, prepared);

    const unrecognized = sourcesOf(
      prepared.map((document) => ({
        ...document,
        page: { ...document.page, path: "/elsewhere" },
      }))
    );

    expect(() =>
      readerCodeWithoutPageData(
        `const readerPageSources = ${unrecognized};`,
        prepared
      )
    ).toThrow("differs");
    expect(runtime).toBe(
      'const readerPageSources = []; const rat_call = "rat_test_person";'
    );
    expect(() => readerCodeWithoutPageData(code, [])).toThrow(
      "ReaderFlags payload differs"
    );
    expect(
      readerCodeWithoutPageData('const unrelated = "rat_call";', prepared)
    ).toContain("rat_call");
    expect(() =>
      readerCodeWithoutPageData("const readerPageSources = run();", prepared)
    ).toThrow("not one static array");
  }
);
