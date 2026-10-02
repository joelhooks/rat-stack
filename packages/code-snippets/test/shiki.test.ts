import { expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";

import {
  Drift,
  Highlighter,
  SourceRepository,
  parseCodeRequest,
  renderCode,
} from "../src/index.ts";
import { shikiLayer } from "../src/shiki.ts";

const sha = "a".repeat(40);

const repositories = [{ adapter: "git", id: "rat-stack", location: "." }];

it.layer(shikiLayer())("whole-file lexical context", (test) => {
  test.effect.prop(
    "P5 selected tokens equal their whole-file counterparts across comments and templates",
    { word: Schema.String.check(Schema.isMaxLength(25)) },
    ({ word }) =>
      Effect.gen(function* tokenParity() {
        const value = word
          .replaceAll("\n", " ")
          .replaceAll("\r", " ")
          .replaceAll("*/", " ")
          .replaceAll("`", " ");

        const source = [
          "/* opening",
          value,
          "still a comment",
          "*/",
          "const template = `",
          value,
          "still a template",
          "`;",
          "export { template }",
        ].join("\n");

        const highlighter = yield* Highlighter;
        const whole = yield* highlighter.tokens(source, "typescript", source);

        const request = yield* parseCodeRequest(
          {
            lang: "ts",
            line: 1,
            meta: `repo=rat-stack path=example.ts at=${sha} lines=2-3,6-7 {3,7}`,
            value: "",
          },
          "page.svx"
        );

        const { snippet } = yield* renderCode(request).pipe(
          Effect.provide(
            Layer.mergeAll(
              SourceRepository.memory(
                repositories,
                new Map([[`rat-stack:${sha}:example.ts`, source]])
              ),
              Drift.silent
            )
          )
        );

        for (const line of snippet.lines) {
          expect(line.tokens).toEqual(whole[line.number - 1]);
        }

        expect(
          snippet.lines.map((line) =>
            line.tokens.map((token) => token.text).join("")
          )
        ).toEqual([value, "still a comment", value, "still a template"]);

        const sliced = yield* highlighter.tokens(
          "still a comment",
          "typescript",
          "sliced"
        );

        expect(whole[2]).not.toEqual(sliced[0]);
      }),
    { arbitrary: { runs: 20, size: 12 } }
  );
});
