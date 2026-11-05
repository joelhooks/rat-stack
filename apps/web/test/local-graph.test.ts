import { describe, expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import {
  expect as expectScene,
  given,
  hover,
  role,
  scene,
  within,
} from "foldkit/scene";

import { ReaderNode } from "../src/client/reader-node.js";
import { update } from "../src/client/reader/update.js";
import { graphNodes } from "../src/features/local-graph.js";
import { view } from "../src/features/reader.js";
import { readerModelFixture } from "./reader-fixture.js";

const route = Arbitrary.schema(Schema.Literals(["/a", "/b", "/c", "/d", "/e"]));

const links = Arbitrary.array(
  Arbitrary.all([route, Arbitrary.schema(Schema.Literals(["A", "B", ""]))]),
  { maxLength: 8, minLength: 0 }
).pipe(
  Arbitrary.map((pairs) =>
    pairs.map(([path, title]) => ({ route: path, title }))
  )
);

const kindOf = (linked: boolean, linking: boolean) => {
  if (linked && linking) {
    return "both";
  }

  return linked ? "out" : "in";
};

describe("local graph nodes", () => {
  it.prop(
    "each other page appears once with a label, blue exactly when it is both linked and linking",
    { inbound: links, outbound: links, self: route },
    ({ inbound, outbound, self }) => {
      const nodes = graphNodes(outbound, inbound, self);
      const outRoutes = new Set<string>(outbound.map((link) => link.route));
      const inRoutes = new Set<string>(inbound.map((link) => link.route));

      expect(nodes.map((node) => node.route).toSorted()).toStrictEqual(
        [...new Set([...outRoutes, ...inRoutes])]
          .filter((path) => path !== self)
          .toSorted()
      );

      for (const node of nodes) {
        const expected = kindOf(
          outRoutes.has(node.route),
          inRoutes.has(node.route)
        );

        expect(node.kind).toBe(expected);
        expect(node.title).not.toBe("");
      }
    }
  );
});

const link = (href: string, text: string) =>
  ReaderNode.Element({
    attributes: [{ name: "href", value: href }],
    children: [ReaderNode.Text({ value: text })],
    tag: "a",
  });

const fencePage = {
  ...readerModelFixture,
  bodyNodes: Option.some([
    ReaderNode.Element({
      attributes: [],
      children: [
        link("/systems/auth", "Auth"),
        link("/lore/effect-basics#errors", "Effect basics"),
        link("#what-it-does", "What it does"),
      ],
      tag: "p",
    }),
  ]),
  page: { ...readerModelFixture.page, path: "/systems/fence" },
  references: Option.some({
    anchors: [],
    backlinks: [
      {
        context: "",
        description: "",
        route: "/lore/effect-basics",
        title: "Effect basics",
      },
      {
        context: "",
        description: "",
        route: "/skills/gardener",
        title: "Gardener",
      },
    ],
    inboundCounts: {},
  }),
};

const graph = role("navigation", { name: "Local graph" });

it("the server-rendered graph links every neighbour and marks pages that are both", () => {
  scene(
    { update, view },
    given(fencePage),
    expectScene(within(graph, role("link", { name: /Auth/u }))).toHaveAttr(
      "class",
      "graph-node graph-out"
    ),
    expectScene(
      within(graph, role("link", { name: /Effect basics/u }))
    ).toHaveAttr("class", "graph-node graph-both"),
    expectScene(within(graph, role("link", { name: /Gardener/u }))).toHaveAttr(
      "href",
      "/skills/gardener"
    ),
    expectScene(
      within(role("main"), role("link", { name: "Auth" }))
    ).not.toHaveAttr("data-graph-lit"),
    hover(within(graph, role("link", { name: /Auth/u }))),
    expectScene(
      within(role("main"), role("link", { name: "Auth" }))
    ).toHaveAttr("data-graph-lit", ""),
    expectScene(
      within(role("main"), role("link", { name: "Effect basics" }))
    ).not.toHaveAttr("data-graph-lit")
  );
});
