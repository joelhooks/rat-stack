import { Option, Schema, flow } from "effect";
import { parseSync } from "vite";

import { ReaderFlags } from "../src/client/reader/model.js";
import type { ReaderPageFlags } from "../src/client/reader/model.js";

const decodePage = Schema.decodeSync(Schema.fromJsonString(ReaderFlags), {
  onExcessProperty: "error",
});

const samePages = Schema.toEquivalence(Schema.Array(ReaderFlags));

const StaticString = Schema.Union([
  Schema.Struct({ type: Schema.Literal("Literal"), value: Schema.String }),
  Schema.Struct({
    expressions: Schema.Tuple([]),
    quasis: Schema.Tuple([
      Schema.Struct({ value: Schema.Struct({ cooked: Schema.String }) }),
    ]),
    type: Schema.Literal("TemplateLiteral"),
  }),
]);

const staticString = flow(
  Schema.decodeUnknownOption(StaticString),
  Option.map((literal) =>
    literal.type === "Literal" ? literal.value : literal.quasis[0].value.cooked
  )
);

export const readerCodeWithoutPageData = (
  code: string,
  expected: readonly ReaderPageFlags[]
) => {
  const parsed = parseSync("reader-bundle.js", code);

  if (parsed.errors.length > 0) {
    throw new Error("Cannot parse emitted reader bundle for the runtime scan");
  }

  const spans = parsed.program.body
    .flatMap((statement) =>
      statement.type === "VariableDeclaration" ? statement.declarations : []
    )
    .flatMap((declaration) => {
      if (
        declaration.id.type !== "Identifier" ||
        declaration.id.name !== "readerPageSources"
      ) {
        return [];
      }

      const payload = declaration.init;

      if (payload?.type !== "ArrayExpression") {
        throw new Error("ReaderFlags payload is not one static array");
      }

      const sources = payload.elements.flatMap((element) => {
        if (element?.type !== "ArrayExpression") {
          return [];
        }

        const [path, json, ...rest] = element.elements;
        const pathValue = staticString(path);
        const jsonValue = staticString(json);

        return rest.length === 0 &&
          Option.isSome(pathValue) &&
          Option.isSome(jsonValue)
          ? [{ json: jsonValue.value, path: pathValue.value }]
          : [];
      });

      if (sources.length !== payload.elements.length) {
        throw new Error("ReaderFlags payload is not one static array");
      }

      const pages = sources.map((source) => decodePage(source.json));

      if (
        !samePages(pages, expected) ||
        sources.some(
          (source, index) => source.path !== expected[index]?.page.path
        )
      ) {
        throw new Error(
          "ReaderFlags payload differs from the prepared artifact"
        );
      }

      return [{ end: payload.end, start: payload.start }];
    });

  let remaining = code;

  for (const span of spans.toReversed()) {
    remaining = `${remaining.slice(0, span.start)}[]${remaining.slice(span.end)}`;
  }

  return remaining;
};
