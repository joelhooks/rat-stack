import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";
import { compile } from "mdsvex";
import remarkGfm from "remark-gfm";
import type { Plugin } from "unified";

import { buildError } from "../scripts/content-lib.ts";
import {
  collectUnlinkedProse,
  findUnlinkedMentions,
} from "../scripts/unlinked-mentions.ts";
import type { UnlinkedProse } from "../scripts/unlinked-mentions.ts";
import { glossaryTerms } from "./generated-content.js";

const terms = [
  {
    routePath: "/lore/the-fence",
    summary: "A useful fence",
    term: "The fence",
  },
  { routePath: "/lore/layers", summary: "Composition", term: "Layer" },
  { routePath: "/lore/reader", summary: "Self", term: "Reader" },
];

const collect = Effect.fn("collectMentionFixture")(function* collect(
  source: string
) {
  const prose: UnlinkedProse[] = [];

  const output = yield* Effect.tryPromise({
    catch: (cause) =>
      buildError("mention fixture compile", "mention-fixture.svx", cause),
    // @effect-diagnostics-next-line asyncFunction:off -- Flatten mdsvex’s nested Promise declaration at its compiler boundary.
    try: async () =>
      await compile(source, {
        rehypePlugins: [collectUnlinkedProse(prose)],
        // SAFETY: remark-gfm is a remark plugin over mdast; mdsvex bundles older unified declarations.
        remarkPlugins: [remarkGfm as Plugin],
      }),
  });

  expect(output).toBeDefined();

  return findUnlinkedMentions(
    [{ prose, route: "/lore/reader", title: "Reader" }],
    terms
  );
});

it.effect(
  "detects planted whole-word mentions without changing the source",
  () =>
    Effect.gen(function* detectPlantedMention() {
      const source =
        "# Reader\n\nEarlier sentence. THE FENCE catches mistakes. Later sentence.\n\nA layer composes behavior.\n\nLayers and underlayer are not the glossary noun.\n\nReader mentions itself.\n";

      const mentions = yield* collect(source);

      expect(mentions).toHaveLength(2);
      expect(
        mentions.find((mention) => mention.target === "/lore/the-fence")
          ?.context
      ).toBe("THE FENCE catches mistakes.");
      expect(
        mentions.find((mention) => mention.target === "/lore/layers")?.context
      ).toBe("A layer composes behavior.");
      expect(
        mentions.some((mention) => mention.target === "/lore/reader")
      ).toBe(false);
    })
);

it.effect(
  "skips links, code, headings, quotations, tables and the Sources section",
  () =>
    Effect.gen(function* excludeNonProse() {
      const source = [
        "# The fence",
        "",
        "## Layer",
        "",
        "[The fence](/lore/the-fence)",
        "",
        "`The fence`",
        "",
        "```text",
        "Layer",
        "```",
        "",
        "> The fence\n>\n> Layer",
        "",
        "| Term | Note |",
        "| --- | --- |",
        "| The fence | Layer |",
        "",
        "## Sources",
        "",
        "The fence and Layer are bibliography text.",
        "",
        "### Notes",
        "",
        "Layer is still in Sources.",
        "",
        "## More",
        "",
        "A final layer mention is ordinary prose.",
      ].join("\n");

      const mentions = yield* collect(source);

      expect(mentions).toHaveLength(1);
      expect(mentions[0]?.context).toBe(
        "A final layer mention is ordinary prose."
      );
    })
);

it.effect("does not turn substrings into whole-word mentions", () =>
  Effect.gen(function* enforceWordBoundaries() {
    const mentions = yield* collect(
      "# Reader\n\nUnderlayer layers Layered _Layer Layer_name and éLayer are not standalone glossary terms.\n"
    );

    expect(mentions).toEqual([]);
  })
);

it.effect(
  "keeps sentence context across inline formatting without counting linked text",
  () =>
    Effect.gen(function* retainInlineContext() {
      const mentions = yield* collect(
        "# Reader\n\nSee [the fence](/lore/the-fence). Then an **unlinked layer** needs attention.\n"
      );

      expect(mentions).toHaveLength(1);
      expect(mentions[0]?.context).toBe(
        "Then an unlinked layer needs attention."
      );
    })
);

const MentionReport = Schema.Array(
  Schema.Struct({
    context: Schema.String,
    from: Schema.String,
    target: Schema.String,
    term: Schema.String,
    title: Schema.String,
  })
);

it.layer(NodeServices.layer)((test) => {
  test.effect(
    "emits gardener candidates owned by the existing glossary index",
    () =>
      Effect.gen(function* checkGardenerReport() {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const text = yield* fs.readFileString(
          path.resolve(
            import.meta.dirname,
            "../../../.brain/data/unlinked-mentions.generated.json"
          )
        );

        const report = yield* Schema.decodeEffect(
          Schema.fromJsonString(MentionReport)
        )(text);

        const keys = report.map(
          (mention) => `${mention.from}\u0000${mention.target}`
        );

        expect(new Set(keys).size).toBe(keys.length);

        for (const mention of report) {
          expect(mention.from).not.toBe(mention.target);
          expect(mention.context.toLowerCase()).toContain(
            mention.term.toLowerCase()
          );
          expect(
            glossaryTerms.some(
              (entry) =>
                entry.term === mention.term &&
                entry.routePath === mention.target
            )
          ).toBe(true);
        }
      })
  );
});
