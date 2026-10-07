import { expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";

import { ReaderBlock, ReaderInline } from "../src/client/reader-document.js";
import { ReaderFlags } from "../src/client/reader-model.js";
import { readerCodeWithoutPageData } from "./reader-bundle-data.js";

it.prop(
  "only the exact prepared ReaderFlags literal is exempt from executable-string checks",
  { page: Arbitrary.schema(ReaderFlags) },
  ({ page }) => {
    const preparedInput = [
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

    const payload = Schema.encodeSync(
      Schema.fromJsonString(Schema.Array(ReaderFlags))
    )(preparedInput);

    const prepared = Schema.decodeSync(
      Schema.fromJsonString(Schema.Array(ReaderFlags))
    )(payload);

    const code = `var pages = Schema.decodeUnknownSync(Schema.Array(ReaderFlags))(${payload}); const rat_call = "rat_test_person";`;
    const runtime = readerCodeWithoutPageData(code, prepared);

    expect(runtime).toBe(
      'var pages = Schema.decodeUnknownSync(Schema.Array(ReaderFlags))([]); const rat_call = "rat_test_person";'
    );
    expect(() => readerCodeWithoutPageData(code, [])).toThrow(
      "ReaderFlags payload differs"
    );
    expect(
      readerCodeWithoutPageData('const unrelated = "rat_call";', prepared)
    ).toContain("rat_call");
    expect(() =>
      readerCodeWithoutPageData(
        "var pages = Schema.decodeUnknownSync(Schema.Array(ReaderFlags))(run());",
        prepared
      )
    ).toThrow("not one static array");
  }
);
