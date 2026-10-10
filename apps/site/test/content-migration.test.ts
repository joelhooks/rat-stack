import { expect, it } from "@effect/vitest";
import { parseMarkdown } from "@foldkit/markdown/vite";
import { Effect, Predicate, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import type { Paragraph, RootContent } from "mdast";

import { createComponentRegistry } from "../scripts/component-registry.ts";
import {
  mapMigrationSource,
  migrateContentSource,
} from "../scripts/content-migration.ts";
import { migrationIslands } from "../scripts/migration-islands.ts";
import { PeerRows, peerComponentRegistry } from "../scripts/peers.ts";
import { contentRoot, stringifyContentMarkdown } from "../scripts/svx-ast.ts";

const block = Schema.Struct({
  kind: Schema.Literals([
    "paragraph",
    "heading",
    "blockquote",
    "code",
    "list",
    "table",
  ]),
  loose: Schema.Boolean,
  text: Schema.Array(
    Schema.Literals([
      "alpha",
      "43:00",
      "clock:03",
      "*literal*",
      "[brackets]",
      "a & b",
      "x < y",
      "λ",
      "emoji 🐀",
    ])
  ),
});

const plainBlock = (input: typeof block.Type): RootContent => {
  const text = {
    type: "text",
    value: input.text.join(" ") || "empty",
  } as const;

  const paragraph: Paragraph = { children: [text], type: "paragraph" };

  switch (input.kind) {
    case "paragraph": {
      return paragraph;
    }

    case "heading": {
      return { children: [text], depth: 2, type: "heading" };
    }

    case "blockquote": {
      return { children: [paragraph], type: "blockquote" };
    }

    case "code": {
      return {
        lang: "text",
        type: "code",
        value: `${text.value}\n<Unknown prop={value}>\n<script>ignored as code</script>`,
      };
    }

    case "list": {
      return {
        children: [1, 2].map(() => ({
          children: [paragraph, paragraph],
          spread: input.loose,
          type: "listItem",
        })),
        ordered: true,
        spread: input.loose,
        start: 3,
        type: "list",
      };
    }

    case "table": {
      return {
        align: ["left"],
        children: [
          {
            children: [{ children: [text], type: "tableCell" }],
            type: "tableRow",
          },
          {
            children: [
              {
                children: [{ type: "inlineCode", value: "literal" }],
                type: "tableCell",
              },
            ],
            type: "tableRow",
          },
        ],
        type: "table",
      };
    }

    default: {
      throw new Error("Unknown generated block");
    }
  }
};

it.effect.prop(
  "generated plain-Markdown ASTs preserve their complete agent output through the Document",
  {
    blocks: Arbitrary.schema(Schema.Array(block)),
  },
  ({ blocks }) =>
    Effect.gen(function* plainRoundTrip() {
      const source = stringifyContentMarkdown(
        contentRoot(blocks.map(plainBlock))
      );

      const result = yield* migrateContentSource(
        source,
        "generated.svx",
        createComponentRegistry()
      );

      expect(result.failures).toEqual([]);
      expect(result.roundTrip?.after).toBe(result.roundTrip?.before);
      expect(result.roundTrip?.before).toBe(source);
    })
);

const peers = Schema.decodeSync(PeerRows)([]);

const registry = peerComponentRegistry(peers, {
  alchemy: "2.0.0-beta.81",
  effect: "4.0.0",
  xstate: "6.0.0-alpha.65",
  xstateEffect: "0.1.0-alpha.7",
});

for (const [source, directive, agentText] of [
  ["<HumanOnly>\n\nHidden body.\n\n</HumanOnly>", ":::HumanOnly", ""],
  ["<AgentOnly>\n\nAgent body.\n\n</AgentOnly>", ":::AgentOnly", "Agent body."],
  [
    '<Diagram alt="flow & purpose">\n\n```text\nA -> B\n```\n\n</Diagram>',
    ':::Diagram{alt="flow &amp; purpose"}',
    "Diagram: flow & purpose",
  ],
  [
    '<CopyPrompt id="learn" />',
    '::CopyPrompt{id="learn"}',
    "Turn on rat-stack learn mode",
  ],
  [
    "<HumanOnly>\n\n<AgentOnly>\n\nNested hidden\n\n</AgentOnly>\n\n</HumanOnly>",
    "::::HumanOnly",
    "",
  ],
  ["<AgentPointer />", "::AgentPointer", "For agents:"],
  ["<Sources />", "::Sources", ""],
  ["<PeerPins />", "::PeerPins", "4.0.0"],
  ["<PeerRoster />", "::PeerRoster", "Repo"],
  ["<PeerSources />", "::PeerSources", ""],
  ["<PeersAlsoSeen />", "::PeersAlsoSeen", "Also seen"],
] as const) {
  it.effect(`maps ${directive} with independent audience semantics`, () =>
    Effect.gen(function* componentMapping() {
      const result = yield* migrateContentSource(
        source,
        "component.svx",
        registry
      );

      expect(result.failures).toEqual([]);
      expect(result.candidate).toContain(directive);
      expect(result.roundTrip?.after).toBe(result.roundTrip?.before);
      expect(result.roundTrip?.after).toContain(agentText);

      if (directive === ":::HumanOnly") {
        expect(result.roundTrip?.after).not.toContain("Hidden body");
      }
    })
  );
}

it.effect(
  "Ref attributes survive mapping and are passed to the existing graph resolver",
  () =>
    Effect.gen(function* referenceMapping() {
      const result = yield* migrateContentSource(
        '<Ref page="/lore/example" id="block" />',
        "ref.svx",
        createComponentRegistry({
          Ref: {
            agent: (input) => [
              {
                children: [
                  {
                    type: "text",
                    value: `${input.attributes.page}#${input.attributes.id}`,
                  },
                ],
                type: "paragraph",
              },
            ],
            human: () => [],
          },
        })
      );

      expect(result.failures).toEqual([]);
      expect(result.candidate).toBe('::Ref{page="/lore/example" id="block"}');
      expect(result.roundTrip?.after).toBe("/lore/example#block\n");
    })
);

it.prop(
  "quoted island attributes preserve punctuation and Unicode",
  {
    alt: Arbitrary.schema(
      Schema.Literals([
        'flow "quoted"',
        "Unicode λ 🐀",
        "backslash \\",
        "angle &lt; and &amp;",
        "literal {braces}",
      ])
    ),
  },
  ({ alt }) => {
    const escaped = alt.replaceAll('"', "&quot;");

    const mapped = mapMigrationSource(
      `<Diagram alt="${escaped}">\n\nBody\n\n</Diagram>`,
      "diagram.svx"
    );

    expect(mapped.failures).toEqual([]);

    const document = parseMarkdown(mapped.candidate, {
      islands: migrationIslands,
    });

    const [island] = document.blocks;

    expect(Predicate.isTagged(island, "Island")).toBe(true);

    if (Predicate.isTagged(island, "Island")) {
      expect(island.attributes.alt).toBe(
        alt.replaceAll("&lt;", "<").replaceAll("&amp;", "&")
      );
    }
  }
);

it("collects independent unsupported constructs with source lines without touching code fences", () => {
  const result = mapMigrationSource(
    "<Unknown />\n\n<script>const x = 1;</script>\n\nValue {computed}\n\n- [x] Task\n\n```ts\n<Unknown />\n{computed}\n```\n",
    "invalid.svx"
  );

  expect(
    result.failures.map((failure) => [failure.construct, failure.line])
  ).toEqual(
    expect.arrayContaining([
      ["Svelte expression", 5],
      ["task list", 7],
      ["raw HTML or unknown component <Unknown>", 1],
      ["script", 3],
    ])
  );
  expect(result.candidate).toContain("```ts\n<Unknown />\n{computed}\n```");
});

it.effect(
  "nested sources and terms remain structured and the YAML block remains unchanged",
  () =>
    Effect.gen(function* frontmatterMapping() {
      const source =
        '---\ntitle: Sample\nterms: [one, two]\nsources:\n  - kind: recording\n    title: Talk\n    recordedAt: "2026-10-06"\n    note: Words\n---\n\n<HumanOnly>\n\nHidden\n\n</HumanOnly>\n\nVisible\n';

      const result = yield* migrateContentSource(
        source,
        "frontmatter.svx",
        createComponentRegistry()
      );

      expect(result.failures).toEqual([]);
      expect(result.roundTrip?.frontmatter.terms).toEqual(["one", "two"]);
      expect(result.roundTrip?.frontmatter.sources).toEqual([
        {
          kind: "recording",
          note: "Words",
          recordedAt: "2026-10-06",
          title: "Talk",
        },
      ]);
      expect(result.roundTrip?.after).toBe(result.roundTrip?.before);
    })
);
