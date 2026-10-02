import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Context, Effect, FileSystem, Layer, Schema } from "effect";
import { mdsvex } from "mdsvex";
import { compile } from "svelte/compiler";
import { expect } from "vitest";

import {
  assertAgentPointerLayout,
  createComponentRegistry,
  renderAgentPage,
  renderSvxMarkdown,
} from "../scripts/component-registry.ts";
import type { ComponentRegistry } from "../scripts/component-registry.ts";
import { ContentBuildError } from "../scripts/content-error.ts";
import { peerComponentRegistry, peerPins, PeerRows } from "../scripts/peers.ts";
import {
  contentLinkHrefs,
  frontmatterData,
  htmlTokens,
  parseContentMarkdown,
  stripHtmlComments,
  visitContentNodes,
} from "../scripts/svx-ast.ts";
import { llmsFullText, llmsText } from "../src/content.ts";
import {
  authMarkdown,
  homeDocumentHtml,
  homeMarkdownTemplate,
  glossaryIndexMarkdown,
  glossaryIndexDocumentHtml,
  skillIndexMarkdown,
  skillIndexDocumentHtml,
  loreIndexMarkdown,
  loreIndexDocumentHtml,
  systemsIndexMarkdown,
  systemsIndexDocumentHtml,
  noVerifyMarkdown,
  noVerifyDocumentHtml,
  tokenmaxxMarkdown,
  tokenmaxxDocumentHtml,
  lawSources,
  skillSources,
  loreSources,
} from "./generated-content.js";

it.effect(
  "keeps audience content inside native HTML wrappers valid at the mdsvex boundary",
  () =>
    Effect.gen(function* checkNativeHtmlAudienceBoundary() {
      const processor = mdsvex({ extensions: [".svx"] });
      const targets: readonly ["human", "agent"] = ["human", "agent"];

      for (const target of targets) {
        const markdown = renderSvxMarkdown(
          "<div>before <HumanOnly>human</HumanOnly><AgentOnly>agent</AgentOnly> after</div>",
          target
        );

        expect(markdown.trim()).toBe(`<div>before ${target} after</div>`);

        const compiled = yield* Effect.promise(
          processor.markup.bind(processor, {
            content: markdown,
            filename: "wrapper.svx",
          })
        );

        expect(compiled).toBeDefined();
        compile(compiled?.code ?? "", { generate: "server" });
      }
    })
);

const pages = [
  {
    documentHtml: homeDocumentHtml,
    routePath: "/",
    text: homeMarkdownTemplate,
  },
  {
    documentHtml: glossaryIndexDocumentHtml,
    routePath: "/glossary",
    text: glossaryIndexMarkdown,
  },
  {
    documentHtml: skillIndexDocumentHtml,
    routePath: "/skills",
    text: skillIndexMarkdown,
  },
  {
    documentHtml: loreIndexDocumentHtml,
    routePath: "/lore",
    text: loreIndexMarkdown,
  },
  {
    documentHtml: systemsIndexDocumentHtml,
    routePath: "/systems",
    text: systemsIndexMarkdown,
  },
  {
    documentHtml: noVerifyDocumentHtml,
    routePath: "/--no-verify",
    text: noVerifyMarkdown,
  },
  {
    documentHtml: tokenmaxxDocumentHtml,
    routePath: "/tokenmaxx",
    text: tokenmaxxMarkdown,
  },
  ...lawSources,
  ...skillSources,
  ...loreSources,
];

const markdownPages = [
  ...pages,
  { routePath: "/auth.md", text: authMarkdown },
  { routePath: "/llms-full.txt", text: llmsFullText("https://ratstack.sh") },
  { routePath: "/llms.txt", text: llmsText("https://ratstack.sh") },
];

it.effect.each(markdownPages)(
  "$routePath has exactly one registry pointer under its H1",
  (page) =>
    Effect.sync(() => {
      expect(() => {
        assertAgentPointerLayout(page.text, page.routePath);
      }, page.routePath).not.toThrow();
    })
);

it.effect("agent page rendering refuses missing and duplicate pointers", () =>
  Effect.sync(() => {
    const rendered = renderAgentPage(
      "# Source\n\nSource facts.",
      "/lore/source",
      "Source"
    );

    const pointer =
      "> For agents: start with the [agent guide](https://ratstack.sh/llms.txt). Every page is Markdown by default; add `Accept: text/html` for HTML.\n";

    expect(rendered).toContain(pointer);
    expect(() => {
      assertAgentPointerLayout(rendered.replace(pointer, ""), "/lore/source");
    }).toThrow(ContentBuildError);
    expect(() => {
      assertAgentPointerLayout(`${rendered}\n${pointer}`, "/lore/source");
    }).toThrow(ContentBuildError);
  })
);

it.effect(
  "HTML pointers are hidden registry components, never visible prose",
  () =>
    Effect.sync(() => {
      for (const page of pages) {
        const tokens = htmlTokens(page.documentHtml);

        const pointer = tokens.find(
          (node) =>
            node.kind === "open" &&
            (node.attributes.class?.split(" ").includes("agent-pointer") ??
              false)
        );

        if (page.routePath === "/tokenmaxx") {
          expect(pointer).toBeUndefined();
          expect(page.documentHtml).not.toContain("For agents:");
          continue;
        }

        expect(pointer?.attributes["aria-hidden"], page.routePath).toBe("true");
        expect(pointer?.attributes.class).toContain("visually-hidden");
        expect(pointer?.attributes.hidden).toBeUndefined();

        const main = tokens.findIndex(
          (node) => node.kind === "open" && node.name === "main"
        );

        expect(tokens[main + 1]).toBe(pointer);
        expect(page.documentHtml).toContain("<body><!-- For agents:");

        const closing = tokens.find(
          (node) =>
            node.kind === "close" &&
            node.name === "p" &&
            pointer !== undefined &&
            node.start > pointer.end
        );

        const visible = stripHtmlComments(
          page.documentHtml.slice(0, pointer?.start) +
            page.documentHtml.slice(closing?.end)
        );

        expect(visible).not.toContain("For agents:");
      }
    })
);

it.effect(
  "leading YAML fences are explicit and retain absolute source offsets",
  () =>
    Effect.sync(() => {
      for (const source of [
        "# No metadata\n\n---\n\nBody.",
        "---\n---\n# Empty",
        "---\r\nname: Test\r\n---\r\n# CRLF",
      ]) {
        const root = parseContentMarkdown(source);
        const heading = root.children.find((node) => node.type === "heading");
        expect(
          source.slice(
            heading?.position?.start.offset,
            heading?.position?.end.offset
          )
        ).toContain("# ");
      }

      expect(frontmatterData("---\n---\n# Empty")).toEqual({});
      expect(frontmatterData("---\r\nname: Test\r\n---\r\n# CRLF")).toEqual({
        name: "Test",
      });
      expect(frontmatterData("# Body\n\n---\nname: Not metadata")).toEqual({});
      expect(
        frontmatterData("---\nnote: |\n  ---\n  body\n---\n# Heading").note
      ).toBe("---\nbody\n");
      expect(() =>
        parseContentMarkdown("---\nname: Missing end", "broken.svx")
      ).toThrow(ContentBuildError);
    })
);

it.effect.prop(
  "diagram payloads and labels survive both targets",
  { payload: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9]+$/u)) },
  ({ payload }) =>
    Effect.sync(() => {
      const source = `# Source\n\n<Diagram alt="A factual map">\n\n\`\`\`text\n${payload}\n\`\`\`\n\n</Diagram>`;

      for (const target of ["agent", "human"] as const) {
        const rendered = renderSvxMarkdown(source, target);
        const code: string[] = [];
        visitContentNodes(parseContentMarkdown(rendered), (node) => {
          if (node.type === "code") {
            code.push(node.value);
          }
        });
        expect(code).toEqual([
          payload.replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
        ]);
        expect(rendered).toContain("A factual map");
      }
    })
);

it.effect(
  "components nest structurally and literal code never becomes a component",
  () =>
    Effect.sync(() => {
      const source =
        "# Source\n\n<AgentOnly>\n\nOuter.\n\n<HumanOnly>\nNot for agents.\n</HumanOnly>\n\n<AgentOnly>Inner.</AgentOnly>\n\n</AgentOnly>\n\n`<Missing />`\n\n```svx\n<Missing />\n```\n";

      const rendered = renderSvxMarkdown(source, "agent");
      expect(rendered).toContain("Outer.");
      expect(rendered).toContain("Inner.");
      expect(rendered).not.toContain("Not for agents.");
      expect(rendered).toContain("<Missing />");

      for (const broken of [
        "<Missing />",
        "<AgentOnly>Unclosed",
        "<Diagram alt={expression} />",
      ]) {
        expect(() => renderSvxMarkdown(broken, "agent")).toThrow(
          ContentBuildError
        );
      }

      expect(() =>
        createComponentRegistry({
          // @ts-expect-error -- A malformed external registration must fail the build even when it bypasses the TypeScript contract.
          Broken: { human: () => [] },
        })
      ).toThrow(ContentBuildError);
    })
);

it.effect(
  "link discovery follows Markdown nodes, definitions, and HTML attributes, not code",
  () =>
    Effect.sync(() => {
      const source =
        '[local][target]\n\n[target]: /lore/target\n\n<a href="/lore/html">HTML</a>\n\n`[not a link](/missing)`\n\n```md\n[also not a link](/missing)\n```\n';

      expect(contentLinkHrefs(source).toSorted()).toEqual([
        "/lore/html",
        "/lore/target",
      ]);
    })
);

class RegistryFixtures extends Context.Service<
  RegistryFixtures,
  {
    readonly registry: ComponentRegistry;
    readonly extension: ComponentRegistry;
  }
>()("test/RegistryFixtures") {
  static readonly layer = Layer.effect(
    RegistryFixtures,
    Effect.gen(function* makeRegistryFixtures() {
      const fileSystem = yield* FileSystem.FileSystem;

      const read = (path: string) =>
        fileSystem.readFileString(
          new URL(`../../../${path}`, import.meta.url).pathname
        );

      const peers = yield* Schema.decodeEffect(Schema.fromJsonString(PeerRows))(
        yield* read(".brain/data/peers.json")
      );

      const registry = peerComponentRegistry(
        peers,
        peerPins(
          yield* read("package.json"),
          yield* read("apps/infra/package.json"),
          yield* read("packages/core/package.json")
        )
      );

      const extension = createComponentRegistry({
        ...registry,
        Proof: {
          agent: () => [
            {
              children: [{ type: "text", value: "Registry proof" }],
              type: "paragraph",
            },
          ],
          human: () => [],
        },
      });

      return RegistryFixtures.of({ extension, registry });
    })
  ).pipe(Layer.provide(NodeServices.layer));
}

it.layer(Layer.provideMerge(RegistryFixtures.layer, NodeServices.layer))(
  "file-backed registry pages",
  (test) => {
    test.effect.each([...lawSources, ...skillSources, ...loreSources])(
      "$routePath uses the shared svx registry",
      (page) =>
        Effect.gen(function* checkFileBackedSourceRegistry() {
          const fileSystem = yield* FileSystem.FileSystem;
          const fixtures = yield* RegistryFixtures;

          const file = new URL(`../../../${page.sourcePath}`, import.meta.url)
            .pathname;

          if (!(yield* fileSystem.exists(file))) {
            return;
          }

          const source = yield* fileSystem.readFileString(file);

          const rendered = renderSvxMarkdown(
            source,
            "agent",
            {},
            fixtures.registry
          );

          expect(rendered.length, page.sourcePath).toBeGreaterThan(0);
          expect(
            renderSvxMarkdown(
              `${source}\n\n<Proof />`,
              "agent",
              {},
              fixtures.extension
            ),
            page.sourcePath
          ).toContain("Registry proof");
        })
    );
  }
);
