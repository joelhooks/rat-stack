import { Schema } from "effect";
import type { Nodes, RootContent } from "mdast";

import type { ComponentDefinition } from "./component-registry.ts";
import type { BlockIndex, ContentBlock } from "./content-blocks.ts";
import { buildError } from "./content-error.ts";
import {
  contentRoot,
  htmlTokens,
  parseContentMarkdown,
  visitContentNodes,
} from "./svx-ast.ts";

const RefAttributes = Schema.Struct({ id: Schema.String, page: Schema.String });

export const resolveReferencedBlock = (
  attributes: Readonly<Record<string, string>>,
  sourcePath: string,
  index: BlockIndex
) => {
  const ref = Schema.decodeUnknownSync(RefAttributes)(attributes);
  const page = index.get(ref.page);
  const block = page?.blocks.find((candidate) => candidate.id === ref.id);

  if (page === undefined || block === undefined) {
    throw buildError(
      "block reference",
      sourcePath,
      new Error(`Missing block reference ${ref.page}#${ref.id}`)
    );
  }

  return {
    block,
    id: ref.id,
    page: ref.page,
    source: page.source,
    title: page.title,
  };
};

export const extractBlockReferences = (source: string) => {
  const references: (typeof RefAttributes.Type)[] = [];

  visitContentNodes(parseContentMarkdown(source), (node) => {
    if (node.type === "html") {
      for (const token of htmlTokens(node.value)) {
        if (token.kind === "open" && token.name === "Ref") {
          references.push(
            Schema.decodeUnknownSync(RefAttributes)(token.attributes)
          );
        }
      }
    }
  });

  return references;
};

const selectBlockNodes = (
  node: Nodes,
  block: ContentBlock
): readonly RootContent[] | undefined => {
  if (
    node.type === "paragraph" &&
    node.position?.start.offset === block.start &&
    node.position.end.offset === block.end
  ) {
    return [structuredClone(node)];
  }

  if (node.type === "list") {
    const index = node.children.findIndex(
      (item) =>
        item.position?.start.offset === block.start &&
        item.position.end.offset === block.end
    );

    const item = node.children[index];

    if (item !== undefined) {
      return [
        structuredClone({
          ...node,
          children: [item],
          start: node.ordered === true ? (node.start ?? 1) + index : node.start,
        }),
      ];
    }
  }

  if ("children" in node) {
    for (const child of node.children) {
      const found = selectBlockNodes(child, block);

      if (found !== undefined) {
        return found;
      }
    }
  }

  return undefined;
};

const stripExplicitIds = (nodes: readonly RootContent[]) => {
  visitContentNodes(contentRoot(nodes), (node) => {
    if (
      (node.type === "paragraph" || node.type === "listItem") &&
      node.children.at(-1)?.type === "text"
    ) {
      const last = node.children.at(-1);

      if (last?.type === "text") {
        last.value = last.value.replace(/\s*\{#[a-zA-Z][\w-]*\}\s*$/u, "");
      }
    }
  });
};

const blockNodes = (
  ref: ReturnType<typeof resolveReferencedBlock>,
  sourcePath: string
) => {
  const root = parseContentMarkdown(ref.source);
  const nodes = selectBlockNodes(root, ref.block);

  if (nodes === undefined) {
    throw buildError(
      "block reference",
      sourcePath,
      new Error(`Block ${ref.page}#${ref.id} has no source node`)
    );
  }

  stripExplicitIds(nodes);

  const definitions = new Map(
    root.children
      .filter((node) => node.type === "definition")
      .map((node) => [node.identifier, node])
  );

  visitContentNodes(contentRoot(nodes), (node) => {
    if ("children" in node) {
      // SAFETY: Replacing linkReference/imageReference with link/image preserves each parent's phrasing-content constraint.
      const children = node.children as RootContent[];

      for (const [position, child] of children.entries()) {
        if (child.type === "linkReference" || child.type === "imageReference") {
          const definition = definitions.get(child.identifier);

          if (definition !== undefined) {
            children[position] =
              child.type === "linkReference"
                ? {
                    children: child.children,
                    title: definition.title,
                    type: "link",
                    url: definition.url,
                  }
                : {
                    alt: child.alt,
                    title: definition.title,
                    type: "image",
                    url: definition.url,
                  };
          }
        }
      }
    }

    if (
      node.type === "html" &&
      htmlTokens(node.value).some((token) => token.name === "Ref")
    ) {
      throw buildError(
        "block reference",
        sourcePath,
        new Error(`Block ${ref.page}#${ref.id} contains a nested Ref`)
      );
    }
  });

  return nodes;
};

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;");

export const refIndexComponent: ComponentDefinition = {
  agent: () => [],
  human(input) {
    const ref = Schema.decodeUnknownSync(RefAttributes)(input.attributes);

    return [
      {
        type: "html",
        value: `<Ref page="${escapeHtml(ref.page)}" id="${escapeHtml(ref.id)}"/>`,
      },
    ];
  },
};

export const createRefComponent = (index: BlockIndex): ComponentDefinition => ({
  agent(input, context) {
    if (input.placement !== "block") {
      throw buildError(
        "block reference",
        context.sourcePath,
        new Error("Ref requires a standalone block")
      );
    }

    const ref = resolveReferencedBlock(
      input.attributes,
      context.sourcePath,
      index
    );

    return [
      ...blockNodes(ref, context.sourcePath),
      {
        children: [
          {
            children: [{ type: "text", value: `from ${ref.title}` }],
            type: "link",
            url: `${ref.page}#${ref.id}`,
          },
        ],
        type: "paragraph",
      },
    ];
  },
  human(input, context) {
    if (input.placement !== "block") {
      throw buildError(
        "block reference",
        context.sourcePath,
        new Error("Ref requires a standalone block")
      );
    }

    const ref = resolveReferencedBlock(
      input.attributes,
      context.sourcePath,
      index
    );

    return [
      { type: "html", value: '<div class="block-transclusion">' },
      ...blockNodes(ref, context.sourcePath),
      {
        type: "html",
        value: `<small class="block-attribution"><a href="${escapeHtml(`${ref.page}#${ref.id}`)}">from ${escapeHtml(ref.title)}</a></small>\n</div>`,
      },
    ];
  },
});
