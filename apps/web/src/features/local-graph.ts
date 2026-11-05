import { Array, Match, Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { ReaderNodeValue } from "../client/reader-node.js";

export interface GraphLink {
  readonly route: string;
  readonly title: string;
}

export type GraphKind = "both" | "in" | "out";

export interface GraphNode extends GraphLink {
  readonly kind: GraphKind;
}

export const graphSideLimit = 12;

export const routeOfHref = (href: string) =>
  (href.split("#").at(0) ?? "").replace(/\/$/u, "") || "/";

const attribute = (
  element: Extract<ReaderNodeValue, { readonly _tag: "Element" }>,
  name: string
) =>
  Option.fromNullishOr(
    element.attributes.find((entry) => entry.name === name)?.value
  );

const textOf: (node: ReaderNodeValue) => string =
  Match.type<ReaderNodeValue>().pipe(
    Match.tagsExhaustive({
      CopyPrompt: () => "",
      Element: (element) =>
        element.tag === "sup" ? "" : element.children.map(textOf).join(""),
      Text: (text) => text.value,
    })
  );

const hasClass = (
  element: Extract<ReaderNodeValue, { readonly _tag: "Element" }>,
  name: string
) =>
  Option.exists(attribute(element, "class"), (classes) =>
    classes.split(/\s+/u).includes(name)
  );

const isOutboundLink = (
  element: Extract<ReaderNodeValue, { readonly _tag: "Element" }>
) =>
  Option.exists(
    attribute(element, "href"),
    (href) => href.startsWith("/") && !href.startsWith("//")
  ) && !hasClass(element, "paragraph-link");

export const outboundLinks: (node: ReaderNodeValue) => readonly GraphLink[] =
  Match.type<ReaderNodeValue>().pipe(
    Match.tag("Element", (element): readonly GraphLink[] => {
      if (element.tag === "sup" || hasClass(element, "referenced-by")) {
        return [];
      }

      if (element.tag === "a" && isOutboundLink(element)) {
        return [
          {
            route: routeOfHref(
              Option.getOrElse(attribute(element, "href"), () => "")
            ),
            title: textOf(element).trim(),
          },
        ];
      }

      return element.children.flatMap(outboundLinks);
    }),
    Match.orElse(() => [])
  );

const referenceTitle: (node: ReaderNodeValue) => readonly string[] =
  Match.type<ReaderNodeValue>().pipe(
    Match.tag("Element", (element): readonly string[] =>
      hasClass(element, "reference-title")
        ? [textOf(element).trim()]
        : element.children.flatMap(referenceTitle)
    ),
    Match.orElse(() => [])
  );

export const referenceLinks: (node: ReaderNodeValue) => readonly GraphLink[] =
  Match.type<ReaderNodeValue>().pipe(
    Match.tag("Element", (element): readonly GraphLink[] =>
      element.tag === "a" && hasClass(element, "reference-card")
        ? [
            {
              route: routeOfHref(
                Option.getOrElse(attribute(element, "href"), () => "")
              ),
              title: referenceTitle(element).at(0) ?? textOf(element).trim(),
            },
          ]
        : element.children.flatMap(referenceLinks)
    ),
    Match.orElse(() => [])
  );

const graphKind = (outbound: boolean, inbound: boolean): GraphKind => {
  if (outbound && inbound) {
    return "both";
  }

  return outbound ? "out" : "in";
};

export const graphNodes = (
  outbound: readonly GraphLink[],
  inbound: readonly GraphLink[],
  self: string
): readonly GraphNode[] => {
  const links = [...outbound, ...inbound];
  const outboundRoutes = new Set(outbound.map((link) => link.route));
  const inboundRoutes = new Set(inbound.map((link) => link.route));

  return Array.dedupe(links.map((link) => link.route))
    .filter((route) => route !== self)
    .map((route) => ({
      kind: graphKind(outboundRoutes.has(route), inboundRoutes.has(route)),
      route,
      title:
        links.find((link) => link.route === route && link.title !== "")
          ?.title ?? route,
    }));
};

interface PlacedNode extends GraphNode {
  readonly x: number;
  readonly y: number;
}

const width = 220;

const rowHeight = 15;

const labelLimit = 12;

const graphHeight = (sides: number) =>
  Math.max(120, Math.ceil((sides * rowHeight) / 0.86) + 24);

const place = (
  nodes: readonly GraphNode[],
  side: 1 | -1,
  height: number
): readonly PlacedNode[] => {
  const center = { x: width / 2, y: height / 2 };
  const radius = width * 0.16;
  const span = Math.min(height * 0.86, nodes.length * rowHeight);

  return nodes.map((node, index) => {
    const y =
      center.y +
      (nodes.length === 1 ? 0 : (index / (nodes.length - 1) - 0.5) * span);

    const lift = (y - center.y) / (height * 0.5);

    return {
      ...node,
      x:
        center.x +
        side * radius * (0.55 + 0.45 * Math.sqrt(Math.max(0, 1 - lift * lift))),
      y,
    };
  });
};

const shortLabel = (title: string) =>
  title.length > labelLimit ? `${title.slice(0, labelLimit - 1)}…` : title;

const fixed = (value: number) => value.toFixed(1);

export interface GraphControl<Message> {
  readonly onHover: (route: string) => Message;
  readonly onLeave: Message;
}

const nodeView = <Message>(
  h: HtmlBuilder<Message>,
  node: PlacedNode,
  control: GraphControl<Message>
) => {
  const right = node.kind !== "in";

  return h.a(
    [
      h.Attribute("href", node.route),
      h.AriaLabel(node.title),
      h.Class(`graph-node graph-${node.kind}`),
      h.OnMouseEnter(control.onHover(node.route)),
      h.OnMouseLeave(control.onLeave),
      h.OnFocus(control.onHover(node.route)),
      h.OnBlur(control.onLeave),
    ],
    [
      h.circle([h.Cx(fixed(node.x)), h.Cy(fixed(node.y)), h.R("3")]),
      h.text(
        [
          h.X(fixed(node.x + (right ? 5 : -5))),
          h.Y(fixed(node.y + 3)),
          h.TextAnchor(right ? "start" : "end"),
        ],
        [shortLabel(node.title)]
      ),
    ]
  );
};

export const localGraphView = <Message>(
  h: HtmlBuilder<Message>,
  nodes: readonly GraphNode[],
  control: GraphControl<Message>
): readonly Html[] => {
  const outs = nodes
    .filter((node) => node.kind !== "in")
    .slice(0, graphSideLimit);

  const ins = nodes
    .filter((node) => node.kind === "in")
    .slice(0, graphSideLimit);

  if (outs.length === 0 && ins.length === 0) {
    return [];
  }

  const height = graphHeight(Math.max(outs.length, ins.length));
  const placed = [...place(outs, 1, height), ...place(ins, -1, height)];
  const center = { x: width / 2, y: height / 2 };

  return [
    h.nav(
      [h.Class("local-graph"), h.AriaLabel("Local graph")],
      [
        h.p([h.Class("pane-heading")], ["Local graph"]),
        h.svg(
          [h.ViewBox(`0 0 ${width} ${height}`), h.Class("graph-canvas")],
          [
            ...placed.map((node) =>
              h.line([
                h.Class(
                  node.kind === "in" ? "graph-edge graph-edge-in" : "graph-edge"
                ),
                h.X1(fixed(center.x)),
                h.Y1(fixed(center.y)),
                h.X2(fixed(node.x)),
                h.Y2(fixed(node.y)),
              ])
            ),
            ...placed.map((node) => nodeView(h, node, control)),
            h.circle([
              h.Class("graph-me"),
              h.Cx(fixed(center.x)),
              h.Cy(fixed(center.y)),
              h.R("5"),
            ]),
          ]
        ),
        h.ul(
          [h.Class("graph-legend")],
          [
            h.li([h.Class("graph-legend-out")], ["links out"]),
            h.li([h.Class("graph-legend-in")], ["links here"]),
            h.li([h.Class("graph-legend-both")], ["both"]),
          ]
        ),
      ]
    ),
  ];
};
