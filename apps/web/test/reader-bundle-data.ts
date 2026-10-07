import { Schema } from "effect";
import { parseSync } from "vite";

import { ReaderFlags } from "../src/client/reader-model.js";
import type { ReaderPageFlags } from "../src/client/reader-model.js";

const pagesSchema = Schema.Array(ReaderFlags);

const decodePages = Schema.decodeSync(Schema.fromJsonString(pagesSchema), {
  onExcessProperty: "error",
});

const samePages = Schema.toEquivalence(pagesSchema);

export const readerCodeWithoutPageData = (
  code: string,
  expected: readonly ReaderPageFlags[]
) => {
  const parsed = parseSync("reader-bundle.js", code);

  if (parsed.errors.length > 0) {
    throw new Error("Cannot parse emitted reader bundle for the runtime scan");
  }

  const spans = parsed.program.body.flatMap((statement) => {
    if (statement.type !== "VariableDeclaration") {
      return [];
    }

    return statement.declarations.flatMap((declaration) => {
      const call = declaration.init;

      if (
        declaration.id.type !== "Identifier" ||
        declaration.id.name !== "pages" ||
        call?.type !== "CallExpression" ||
        code.slice(call.callee.start, call.callee.end) !==
          "Schema.decodeUnknownSync(Schema.Array(ReaderFlags))"
      ) {
        return [];
      }

      const payload = call.arguments.at(0);

      if (payload?.type !== "ArrayExpression" || call.arguments.length !== 1) {
        throw new Error("ReaderFlags payload is not one static array");
      }

      const pages = decodePages(code.slice(payload.start, payload.end));

      if (!samePages(pages, expected)) {
        throw new Error(
          "ReaderFlags payload differs from the prepared artifact"
        );
      }

      return [{ end: payload.end, start: payload.start }];
    });
  });

  let remaining = code;

  for (const span of spans.toReversed()) {
    remaining = `${remaining.slice(0, span.start)}[]${remaining.slice(span.end)}`;
  }

  return remaining;
};
