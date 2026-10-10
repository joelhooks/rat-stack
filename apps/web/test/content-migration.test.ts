import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import * as Markdown from "@foldkit/markdown";
import { Effect, Option, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";
import type { Document, HtmlBuilder } from "foldkit/html";

import { codeIdentity } from "../../mischief/scripts/migration-document.ts";
import { htmlPlainText, htmlTokens } from "../../mischief/scripts/svx-ast.ts";
import { migrationHandPage } from "../scripts/migration-hand-page.ts";

it.effect(
  "the hand page renders its source Document in apps/web and preserves the complete old Markdown response",
  () =>
    Effect.gen(function* handPageProof() {
      const page = yield* migrationHandPage;
      expect(page.metadata.bibliography).toHaveLength(6);
      expect(page.metadata.terms).toEqual([
        "Service construction",
        "Dependency capture",
      ]);
      expect(page.markdown).toBe(page.baseline);

      const rendered = yield* renderToString(
        {
          Flags: Schema.Struct({}),
          init: () => ({ model: page.document }),
          view: (
            model: Markdown.MarkdownDocument,
            h: HtmlBuilder<never>
          ): Document => ({
            body: Markdown.view(model, {
              views: {
                CodeBlock: (block) => {
                  const key = codeIdentity({
                    lang: Option.getOrUndefined(block.maybeLanguage),
                    meta: Option.getOrUndefined(block.maybeMeta),
                    value: block.value,
                  });

                  const snippet = page.snippets.get(key);

                  if (snippet === undefined) {
                    return h.pre([], [h.code([], [block.value])]);
                  }

                  return h.figure(
                    [h.Class("code-snippet")],
                    [
                      h.figcaption(
                        [],
                        [
                          h.a(
                            [h.Href(snippet.url)],
                            [
                              `${snippet.request.path} at ${snippet.request.commit}`,
                            ]
                          ),
                        ]
                      ),
                      h.pre(
                        [],
                        [
                          h.code(
                            [],
                            snippet.lines.flatMap((line, index) => [
                              ...(index === 0 ? [] : ["\n"]),
                              h.span(
                                [h.DataAttribute("line", String(line.number))],
                                line.tokens.map((token) =>
                                  h.span([], [token.text])
                                )
                              ),
                            ])
                          ),
                        ]
                      ),
                    ]
                  );
                },
              },
            }),
            title: page.metadata.title,
          }),
        },
        { flags: {}, isHydratable: false }
      );

      const text = htmlPlainText(rendered.html);

      const figures = htmlTokens(rendered.html).filter(
        (token) =>
          token.kind === "open" &&
          token.name === "figure" &&
          token.attributes.class === "code-snippet"
      );

      expect(figures).toHaveLength(2);
      expect(text).toContain("export class FileInspector");
      expect(text).toContain("FileInspector.inspect");
      expect(rendered.html).toContain('href="/lore/error-model"');
      expect(text).toContain("Sources");
      expect(text).toContain("Kit Langton");
    }).pipe(Effect.provide(NodeServices.layer))
);
