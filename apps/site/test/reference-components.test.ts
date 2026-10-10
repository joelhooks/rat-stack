import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";

import {
  createComponentRegistry,
  renderSvxMarkdown,
} from "../scripts/component-registry.ts";
import {
  groupUnlinkedMentions,
  linkedFromComponent,
  unlinkedMentionsComponent,
} from "../scripts/reference-components.ts";
import {
  htmlTokens,
  parseContentMarkdown,
  visitContentNodes,
} from "../scripts/svx-ast.ts";
import { UnlinkedMentionsSchema } from "../scripts/unlinked-mentions.ts";
import { staticAssetGeneration } from "../src/bundled-content.generated.js";
import { contentResources, readContent } from "./content-fixture.js";
import { lawSources, loreSources, skillSources } from "./generated-content.js";

it.effect(
  "keeps every Markdown read representation independent of HTML assets",
  () =>
    Effect.gen(function* independentMarkdownReads() {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const assets = path.resolve(
        import.meta.dirname,
        "../dist/content/assets",
        staticAssetGeneration
      );

      for (const resource of contentResources) {
        const markdown = yield* fs.readFileString(
          path.join(assets, `${resource.routePath.slice(1)}.md`)
        );

        const read = readContent(resource.id);
        expect(read).toBeDefined();
        expect(read?.text, resource.id).toBe(markdown);
        expect(read?.title).toBe(resource.title);
      }
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "registry audiences share reference facts and native disclosures escape context",
  () =>
    Effect.sync(() => {
      const context =
        'The <img src=x onerror="alert(1)"> & quoted title is only text.';

      const source =
        '<LinkedFrom page="/lore/target" />\n\n<UnlinkedMentions page="/lore/target" />';

      const registry = createComponentRegistry({
        LinkedFrom: linkedFromComponent(
          new Map([
            [
              "/lore/target",
              [
                {
                  context,
                  description: "Page summary",
                  route: "/lore/source",
                  title: "Source <title>",
                },
              ],
            ],
          ])
        ),
        UnlinkedMentions: unlinkedMentionsComponent(
          groupUnlinkedMentions([
            {
              context,
              from: "/lore/source",
              target: "/lore/target",
              term: "title",
              title: "Source <title>",
            },
          ])
        ),
      });

      const human = renderSvxMarkdown(source, "human", {}, registry);
      const agent = renderSvxMarkdown(source, "agent", {}, registry);
      const tokens = htmlTokens(human);

      expect(human).toContain(
        "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp;"
      );
      expect(human).toContain("Unlinked mentions (1)");
      expect(tokens.some((token) => token.name === "img")).toBe(false);
      expect(
        tokens
          .filter((token) => token.name === "details" && token.kind === "open")
          .every((token) => !("open" in token.attributes))
      ).toBe(true);
      expect(agent).not.toMatch(/<details|<sup/u);
      const texts: string[] = [];
      const links: string[] = [];

      visitContentNodes(parseContentMarkdown(agent), (node) => {
        if (node.type === "text") {
          texts.push(node.value);
        }

        if (node.type === "link") {
          links.push(node.url);
        }
      });
      expect(texts.join("")).toContain("Source <title>");
      expect(texts.join("")).toContain("Page summary");
      expect(texts.join("")).toContain(context);
      expect(links).toEqual([
        "https://ratstack.sh/lore/source",
        "https://ratstack.sh/lore/source",
      ]);
    })
);

it.effect(
  "empty registry references disappear and page attributes are schema checked",
  () =>
    Effect.sync(() => {
      const registry = createComponentRegistry({
        LinkedFrom: linkedFromComponent(new Map()),
        UnlinkedMentions: unlinkedMentionsComponent(new Map()),
      });

      const source =
        '<LinkedFrom page="/lore/empty" />\n\n<UnlinkedMentions page="/lore/empty" />';

      for (const audience of ["human", "agent"] as const) {
        expect(renderSvxMarkdown(source, audience, {}, registry).trim()).toBe(
          ""
        );
        expect(() =>
          renderSvxMarkdown("<UnlinkedMentions />", audience, {}, registry)
        ).toThrow();
      }
    })
);

it.layer(NodeServices.layer)((test) => {
  test.effect(
    "published unlinked lists use precisely the generated gardener facts",
    () =>
      Effect.gen(function* checkGardenerReferences() {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const json = yield* fs.readFileString(
          path.resolve(
            import.meta.dirname,
            "../../../.brain/data/unlinked-mentions.generated.json"
          )
        );

        const report = yield* Schema.decodeEffect(
          Schema.fromJsonString(UnlinkedMentionsSchema)
        )(json);

        const groups = groupUnlinkedMentions(report);

        for (const page of [...loreSources, ...skillSources, ...lawSources]) {
          const entries = groups.get(page.routePath) ?? [];

          const section = htmlTokens(page.documentHtml).find(
            (token) =>
              token.kind === "open" &&
              token.name === "section" &&
              token.attributes.class === "bibliography unlinked-mentions"
          );

          expect(section !== undefined).toBe(entries.length > 0);

          if (entries.length === 0) {
            continue;
          }

          const registry = createComponentRegistry({
            UnlinkedMentions: unlinkedMentionsComponent(groups),
          });

          const source = `<UnlinkedMentions page="${page.routePath}" />`;
          const human = renderSvxMarkdown(source, "human", {}, registry).trim();
          const agent = renderSvxMarkdown(source, "agent", {}, registry).trim();

          expect(page.documentHtml, page.routePath).toContain(human);
          expect(page.text, page.routePath).toContain(agent);
          expect(human).not.toContain("inbound-count");
          expect(human).toContain(`Unlinked mentions (${entries.length})`);
        }
      })
  );
});
