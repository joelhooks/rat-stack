import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Predicate, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { renderToString } from "foldkit/experimental/server";
import type { HtmlBuilder } from "foldkit/html";

import {
  compileReaderBodies,
  compileReaderBody,
} from "../../mischief/scripts/reader-body-document.ts";
import { readerCopyPrompts } from "../../mischief/scripts/reader-body-flags.ts";
import { prepareReaderSiteInputs } from "../../mischief/scripts/reader-site-inputs.ts";
import { ReaderNode } from "../src/client/reader-node.js";
import type { ReaderNodeValue } from "../src/client/reader-node.js";
import type { ReaderMessage } from "../src/client/reader/message.js";
import { ClipboardAccess } from "../src/client/reader/model.js";
import { renderReaderNode } from "../src/features/reader-node.js";
import { readerCopyControl } from "../src/features/reader.js";

const prompts = readerCopyPrompts("https://ratstack.sh");

const text = Schema.String.check(
  Schema.isPattern(/^[\u0020-\u007E\n\t]{0,60}$/u)
);

const TextNode = Schema.TaggedStruct("Text", { value: text });

const attributes = Schema.Array(
  Schema.Struct({
    name: Schema.Literals(["class", "title", "data-label"]),
    value: text,
  })
);

const Leaf = Schema.TaggedStruct("Element", {
  attributes,
  children: Schema.Array(TextNode),
  tag: Schema.Literals(["code", "strong", "em"]),
});

const CopyPromptNode = Schema.TaggedStruct("CopyPrompt", {
  id: Schema.Literals(["connect", "page", "setup"]),
  primary: Schema.Boolean,
});

const Branch = Schema.TaggedStruct("Element", {
  attributes,
  children: Schema.Array(Schema.Union([TextNode, Leaf, CopyPromptNode])),
  tag: Schema.Literals(["div", "span"]),
});

const Tree = Schema.TaggedStruct("Element", {
  attributes,
  children: Schema.Array(Schema.Union([TextNode, Leaf, Branch])),
  tag: Schema.Literals(["div", "section"]),
});

const Flags = Schema.Struct({ nodes: Schema.Array(Tree) });

const normalize = (
  nodes: readonly ReaderNodeValue[]
): readonly ReaderNodeValue[] => {
  const result: ReaderNodeValue[] = [];

  for (const node of nodes) {
    if (Predicate.isTagged(node, "CopyPrompt")) {
      result.push(node);
    } else if (Predicate.isTagged(node, "Text")) {
      const previous = result.at(-1);

      if (node.value !== "") {
        if (Predicate.isTagged(previous, "Text")) {
          result[result.length - 1] = ReaderNode.Text({
            value: previous.value + node.value,
          });
        } else {
          result.push(node);
        }
      }
    } else {
      result.push({
        ...node,
        attributes: [
          ...new Map(
            node.attributes.map((attribute) => [attribute.name, attribute])
          ).values(),
        ],
        children: normalize(node.children),
      });
    }
  }

  return result;
};

it.effect.prop(
  "round trips generated reader trees through Foldkit HTML without losing text, structure or attributes",
  { nodes: Arbitrary.schema(Schema.Array(Tree)) },
  ({ nodes }) =>
    Effect.gen(function* roundTrip() {
      const rendered = yield* renderToString(
        {
          Flags,
          init: (flags) => ({ commands: [], model: flags }),
          view: (model, h: HtmlBuilder<ReaderMessage>) => ({
            body: h.main(
              [],
              [
                h.h1([], ["Round trip"]),
                ...model.nodes.map((node) =>
                  renderReaderNode(node, h, (id, primary) =>
                    readerCopyControl(
                      {
                        clipboardAccess: ClipboardAccess.Available(),
                        copyPrompts: prompts,
                        copyStatuses: {},
                      },
                      h,
                      id,
                      primary
                    )
                  )
                ),
              ]
            ),
            title: "Round trip",
          }),
        },
        { flags: { nodes }, isHydratable: false }
      );

      const parsed = yield* compileReaderBody(
        rendered.html,
        "generated tree",
        prompts
      );

      expect(normalize(parsed.nodes.slice(1))).toEqual(normalize(nodes));
    })
);

it.effect(
  "preserves the heading, breadcrumb and complete human body while removing only shared chrome",
  () =>
    Effect.gen(function* bodyProjection() {
      const body = yield* compileReaderBody(
        '<main><p class="agent-pointer">Agents</p><aside class="workshop-callout">Workshop</aside><nav aria-label="Breadcrumb"><a href="/skills">skills</a> / skill-name</nav><h1 id="heading">Human title</h1><p>Human-only body</p><table><tbody><tr><td data-label="Name">Value</td></tr></tbody></table><section id="linked-from"><h2>Linked from</h2></section></main>',
        "fixture"
      );

      expect(body.heading).toBe("Human title");
      expect(body.breadcrumb).toEqual({
        href: "/skills",
        label: "skills",
        name: "skill-name",
      });
      expect(body.nodes.at(0)).toEqual(
        ReaderNode.Element({
          attributes: [{ name: "id", value: "heading" }],
          children: [ReaderNode.Text({ value: "Human title" })],
          tag: "h1",
        })
      );
      expect(body.nodes).toHaveLength(4);
    })
);

it.effect(
  "projects every published lore, system and skill body from the real generated content",
  () =>
    Effect.gen(function* publishedCorpus() {
      const inputs = yield* prepareReaderSiteInputs;

      const pages = inputs.pages.filter((page) =>
        /^\/(?:lore|systems|skills)(?:\/|$)/u.test(page.path)
      );

      const bodies = yield* compileReaderBodies(pages);

      expect(bodies).toHaveLength(pages.length);
      expect(
        bodies.every((body) => body.nodes.length > 0 && body.heading.length > 0)
      ).toBe(true);
    }).pipe(Effect.provide(NodeServices.layer))
);

it.effect(
  "refuses human content before the heading rather than discarding it with shared chrome",
  () =>
    Effect.gen(function* prefixPreservation() {
      const result = yield* compileReaderBody(
        "<main><p>Human introduction</p><h1>Title</h1></main>",
        "fixture"
      ).pipe(Effect.flip);

      expect(result.message).toContain("Human content precedes the heading");
    })
);

it.effect(
  "accumulates unsupported node and attribute repairs instead of falling back to HTML",
  () =>
    Effect.gen(function* rejectedProjection() {
      const result = yield* compileReaderBody(
        '<main><h1>Title</h1><unknown onclick="bad()"><script>bad()</script><p onmouseover="bad()">Body</p></unknown></main>',
        "fixture"
      ).pipe(Effect.flip);

      expect(result.sourcePath).toBe("fixture");
      expect(result.message).toContain("Unsupported element <unknown>");
      expect(result.message).toContain("Unsupported attribute onclick");
      expect(result.message).toContain("Unsupported node script");
      expect(result.message).toContain("Unsupported attribute onmouseover");
    })
);
