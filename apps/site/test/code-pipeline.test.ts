import { expect, it } from "@effect/vitest";
import {
  Drift,
  SourceRepository,
  codeIdentity,
  prepareCode,
} from "@rat-stack/code-snippets";
import { plainLayer } from "@rat-stack/code-snippets/plain";
import { FenceHighlighter, shikiLayer } from "@rat-stack/code-snippets/shiki";
import { Effect, Layer, Schema } from "effect";
import { Parser } from "htmlparser2";

import {
  codeComponent,
  collectCodeFences,
  snippetHtml,
} from "../scripts/code-pipeline.ts";
import {
  createComponentRegistry,
  renderSvxMarkdown,
} from "../scripts/component-registry.ts";
import { buildError } from "../scripts/content-lib.ts";
import { renderMarkdownHtml } from "../scripts/markdown-html.ts";
import { parseContentMarkdown } from "../scripts/svx-ast.ts";

const sha = "a".repeat(40);

const layer = Layer.mergeAll(
  SourceRepository.memory(
    [{ adapter: "git", id: "rat-stack", location: "." }],
    new Map()
  ),
  plainLayer(),
  Drift.silent
);

const codeText = (html: string) => {
  let text = "";
  let depth = 0;

  const parser = new Parser({
    onclosetag() {
      if (depth > 0) {
        depth -= 1;
      }
    },
    onopentag(name) {
      if (depth > 0) {
        depth += 1;
      } else if (name === "code") {
        depth = 1;
      }
    },
    ontext(value) {
      if (depth > 0) {
        text += value;
      }
    },
  });

  parser.write(html);
  parser.end();

  return text;
};

const coloredTokens = (html: string) => {
  const tokens: { style: string; text: string }[] = [];
  let active = false;

  const parser = new Parser({
    onclosetag(name) {
      if (name === "span") {
        active = false;
      }
    },
    onopentag(name, attributes) {
      active = name === "span" && (attributes.style ?? "").includes("color:");

      if (active) {
        tokens.push({ style: attributes.style ?? "", text: "" });
      }
    },
    ontext(value) {
      if (active) {
        const token = tokens.at(-1);

        if (token) {
          token.text += value;
        }
      }
    },
  });

  parser.write(html);
  parser.end();

  return tokens.flatMap(({ style, text }) =>
    text.trim().length === 0
      ? []
      : [
          {
            style: style
              .split(";")
              .filter(Boolean)
              .map((entry) => entry.trim())
              .toSorted()
              .join(";"),
            text: text.trim(),
          },
        ]
  );
};

it.layer(shikiLayer())("theme rendering parity", (test) => {
  test.effect(
    "pinned tokens render the ordinary fence's colors and font styles",
    () =>
      Effect.gen(function* themeParity() {
        const body =
          'export const greet = (name: string) => "hello " + name; // greeting';

        const nodes = collectCodeFences(
          `\`\`\`ts repo=rat-stack path=example.ts at=${sha} lines=1-1 {1}\n\`\`\``,
          "theme.svx"
        );

        const prepared = yield* prepareCode(
          nodes.map((node) => ({ node, sourcePath: "theme.svx" }))
        ).pipe(
          Effect.provide([
            Drift.silent,
            SourceRepository.memory(
              [{ adapter: "git", id: "rat-stack", location: "." }],
              new Map([[`rat-stack:${sha}:example.ts`, body]])
            ),
          ])
        );

        const [snippet] = prepared.snippets.values();
        expect(snippet).toBeDefined();

        if (!snippet) {
          return;
        }

        const ordinary = yield* FenceHighlighter;
        const expected = coloredTokens(ordinary.render(body, "ts"));
        expect(
          new Set(
            expected.map((token) =>
              token.style.split(";").find((entry) => entry.startsWith("color:"))
            )
          ).size
        ).toBeGreaterThan(3);
        expect(coloredTokens(snippetHtml(snippet))).toEqual(expected);
      })
  );
});

it.effect.prop(
  "P6 registry renderers preserve exactly the same visible source text",
  { word: Schema.String.check(Schema.isMaxLength(25)) },
  ({ word }) =>
    Effect.gen(function* dualParity() {
      const body = `const value = ${JSON.stringify(word)};\nexport { value };`;
      const source = `\`\`\`ts {2} title="example.ts"\n${body}\n\`\`\``;
      const nodes = collectCodeFences(source, "page.svx");

      const prepared = yield* prepareCode(
        nodes.map((node) => ({ node, sourcePath: "page.svx" }))
      );

      const registry = createComponentRegistry({
        Code: codeComponent(prepared.snippets),
      });

      const human = renderSvxMarkdown(source, "human", {}, registry);
      const agent = renderSvxMarkdown(source, "agent", {}, registry);

      const markdownCode = parseContentMarkdown(agent).children.find(
        (node) => node.type === "code"
      );

      expect(
        markdownCode?.type === "code" ? markdownCode.value : undefined
      ).toBe(body);
      expect(codeText(human)).toBe(body);
      expect(
        prepared.snippets
          .get(codeIdentity(nodes[0] ?? { value: "" }))
          ?.lines.map((line) => line.text)
          .join("\n")
      ).toBe(body);
      expect(human).toContain("code-highlighted");
    }).pipe(Effect.provide(layer)),
  { arbitrary: { runs: 40, size: 12 } }
);

it.effect(
  "pinned fences render Git provenance, real line numbers and omitted gaps",
  () =>
    Effect.gen(function* referenceSeam() {
      const source = `\`\`\`ts repo=rat-stack path=example.ts at=${sha} lines=1-2,5-6 {2,5}\n\`\`\``;

      const prepared = yield* prepareCode(
        collectCodeFences(source, "page.svx").map((node) => ({
          node,
          sourcePath: "page.svx",
        }))
      );

      const registry = createComponentRegistry({
        Code: codeComponent(prepared.snippets),
      });

      const html = renderSvxMarkdown(source, "human", {}, registry);
      const markdown = renderSvxMarkdown(source, "agent", {}, registry);
      expect(html).toContain("⋯ 2 lines");
      expect(html).toContain(
        `https://gitlab.example/project/-/blob/${sha}/example.ts#L1-L6`
      );
      expect(markdown).toContain(
        `example.ts at ${sha}; lines 1-2,5-6; highlighted 2,5.`
      );
      expect(codeText(html)).toBe("one\ntwo\nfive\nsix");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          SourceRepository.memory(
            [
              {
                adapter: "git",
                id: "rat-stack",
                linkTemplate:
                  "https://gitlab.example/project/-/blob/{sha}/{path}#L{start}-L{end}",
                location: ".",
              },
            ],
            new Map([
              [
                `rat-stack:${sha}:example.ts`,
                "one\ntwo\nthree\nfour\nfive\nsix",
              ],
            ])
          ),
          plainLayer(),
          Drift.silent
        )
      )
    )
);

it.effect("decorated code survives the markdown HTML pipeline", () =>
  Effect.gen(function* compilerSeam() {
    const source =
      '```ts {1} title="example.ts"\nconst object = { value: `<tag>` };\n```';

    const prepared = yield* prepareCode(
      collectCodeFences(source, "page.svx").map((node) => ({
        node,
        sourcePath: "page.svx",
      }))
    );

    const registry = createComponentRegistry({
      Code: codeComponent(prepared.snippets),
    });

    const html = renderSvxMarkdown(source, "human", {}, registry);

    const rendered = yield* Effect.try({
      catch: (cause) => buildError("code pipeline seam", "page.svx", cause),
      try: () => renderMarkdownHtml(html, { sourcePath: "page.svx" }),
    });

    expect(codeText(rendered)).toBe("const object = { value: `<tag>` };");
    expect(codeText(rendered)).toBe(codeText(html));
  }).pipe(Effect.provide(layer))
);
