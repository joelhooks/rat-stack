import { expect, it } from "@effect/vitest";
import {
  Drift,
  SourceRepository,
  codeIdentity,
  prepareCode,
} from "@rat-stack/code-snippets";
import { plainLayer } from "@rat-stack/code-snippets/plain";
import { Effect, Layer, Schema } from "effect";
import { Parser } from "htmlparser2";
import { compile as compileMdsvex } from "mdsvex";
import { compile } from "svelte/compiler";

import { codeComponent, collectCodeFences } from "../scripts/code-pipeline.ts";
import {
  createComponentRegistry,
  renderSvxMarkdown,
} from "../scripts/component-registry.ts";
import { escapeSvelteBraces, buildError } from "../scripts/content-lib.ts";
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
  const lines: string[] = [];
  let depth = 0;

  const parser = new Parser({
    onclosetag() {
      if (depth > 0) {
        depth -= 1;
      }
    },
    onopentag(name, attributes) {
      if (depth > 0) {
        depth += 1;
      } else if (name === "span" && attributes.class === "code-text") {
        depth = 1;
        lines.push("");
      }
    },
    ontext(value) {
      if (depth > 0) {
        lines[lines.length - 1] = (lines.at(-1) ?? "") + value;
      }
    },
  });

  parser.write(html);
  parser.end();

  return lines.join("\n");
};

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

it.effect("decorated code survives the real mdsvex/Svelte boundary", () =>
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

    const compiled = yield* Effect.tryPromise({
      catch: (cause) => buildError("code compiler seam", "page.svx", cause),
      // @effect-diagnostics-next-line asyncFunction:off -- mdsvex owns this Promise compiler boundary.
      try: async () =>
        await compileMdsvex(html, {
          highlight: false,
          rehypePlugins: [escapeSvelteBraces],
        }),
    });

    expect(compiled).toBeDefined();
    compile(compiled?.code ?? "", { generate: "server" });
  }).pipe(Effect.provide(layer))
);
