// @effect-diagnostics-next-line nodeBuiltinImport:off -- Build-only block IDs use SHA-256.
import { createHash } from "node:crypto";

import { Effect } from "effect";
import type { Nodes } from "mdast";
import { compile } from "mdsvex";
import type { Plugin } from "unified";

import { buildError } from "./content-lib.ts";
import {
  htmlPlainText,
  parseContentMarkdown,
  visitContentNodes,
} from "./svx-ast.ts";

interface BlockNode {
  readonly type: string;
  readonly tagName?: string;
  value?: string;
  readonly position?:
    | {
        readonly start: {
          readonly offset?: number | undefined;
          readonly line: number;
          readonly column: number;
        };
        readonly end: {
          readonly offset?: number | undefined;
          readonly line: number;
          readonly column: number;
        };
      }
    | undefined;
  properties?: Record<string, string>;
  children?: BlockNode[];
}

export interface ContentBlock {
  readonly end: number;
  readonly id: string;
  readonly start: number;
  readonly text: string;
}

export interface BlockPage {
  readonly routePath: string;
  readonly title: string;
  readonly rawText: string;
}

const explicitAnchor = /\s*\{#(?<id>[a-zA-Z][\w-]*)\}\s*$/u;

const explicitText = (node: BlockNode): BlockNode | undefined => {
  const children = node.children ?? [];

  if (node.tagName === "li") {
    const first = children.find(
      (child) => child.type !== "text" || child.value?.trim() !== ""
    );

    if (first?.tagName === "p") {
      return explicitText(first);
    }

    const boundary = children.findIndex(
      (child) => child.tagName === "ul" || child.tagName === "ol"
    );

    const inlineChildren =
      boundary === -1 ? children : children.slice(0, boundary);

    return inlineChildren.findLast(
      (child) => child.type === "text" && child.value?.trim() !== ""
    );
  }

  const last = children.at(-1);

  return last?.type === "text" ? last : undefined;
};

const explicitId = (node: BlockNode) =>
  explicitAnchor.exec(explicitText(node)?.value ?? "")?.groups?.id;

const nodeText = (node: BlockNode): string =>
  node.value ?? (node.children ?? []).map(nodeText).join("");

const sourceNodeText = (node: Nodes): string => {
  if (node.type === "html") {
    return htmlPlainText(node.value);
  }

  if (node.type === "paragraph") {
    return node.children
      .map((child, index) =>
        child.type === "text" && index === node.children.length - 1
          ? child.value.replace(explicitAnchor, "")
          : sourceNodeText(child)
      )
      .join("");
  }

  if (node.type === "image" || node.type === "imageReference") {
    return node.alt ?? "";
  }

  if ("value" in node) {
    return node.value;
  }

  if ("children" in node) {
    const separator =
      node.type === "list" ||
      node.type === "listItem" ||
      node.type === "blockquote"
        ? "\n"
        : "";

    return node.children.map(sourceNodeText).join(separator);
  }

  return node.type === "break" ? "\n" : "";
};

const sourceBlockTexts = (source: string) => {
  const texts = new Map<string, string>();

  visitContentNodes(parseContentMarkdown(source), (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;

    if (
      (node.type === "paragraph" || node.type === "listItem") &&
      start !== undefined &&
      end !== undefined
    ) {
      texts.set(`${start}:${end}`, sourceNodeText(node));
    }
  });

  return texts;
};

const uniqueBlockId = (base: string, occupied: ReadonlySet<string>) => {
  let id = base;
  let suffix = 2;

  while (occupied.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }

  return id;
};

export const paragraphAnchors =
  (source: string, blocks: ContentBlock[] = []): Plugin<[], BlockNode> =>
  () =>
  (tree) => {
    const texts = sourceBlockTexts(source);
    const used = new Set<string>();
    const explicit = new Set<string>();
    const explicitIds = new Map<BlockNode, string>();

    const reserve = (node: BlockNode, parent?: BlockNode): void => {
      const inheritedMarker =
        parent?.tagName === "li" && explicitText(parent) === explicitText(node);

      if ((node.tagName === "p" || node.tagName === "li") && !inheritedMarker) {
        const id = explicitId(node);

        if (id !== undefined) {
          if (explicit.has(id)) {
            throw buildError(
              "block anchor",
              "content",
              new Error(`Duplicate explicit block ID ${id}`)
            );
          }

          explicit.add(id);
          explicitIds.set(node, id);
        }
      }

      if (node.properties?.id !== undefined) {
        used.add(node.properties.id);
      }

      for (const child of node.children ?? []) {
        reserve(child, node);
      }

      if (explicitIds.has(node)) {
        const marker = explicitText(node);

        if (marker?.value !== undefined) {
          marker.value = marker.value.replace(explicitAnchor, "");
        }
      }
    };

    reserve(tree);

    const visit = (node: BlockNode): void => {
      if (node.tagName === "p" || node.tagName === "li") {
        const ownId = explicitIds.get(node);

        const start = node.position?.start.offset;
        const end = node.position?.end.offset;

        const text = (texts.get(`${start}:${end}`) ?? nodeText(node))
          .normalize("NFC")
          .replaceAll(/\s+/gu, " ")
          .trim();

        const base =
          ownId ??
          `${node.tagName}-${createHash("sha256").update(text).digest("hex").slice(0, 12)}`;

        const occupied =
          ownId === undefined ? new Set([...used, ...explicit]) : used;

        const id = uniqueBlockId(base, occupied);

        used.add(id);
        node.properties = { ...node.properties, id };

        if (start !== undefined && end !== undefined) {
          blocks.push({
            end,
            id,
            start,
            text,
          });
        }

        for (const child of node.children ?? []) {
          visit(child);
        }

        node.children?.push({
          children: [{ type: "text", value: "¶" }],
          properties: {
            "aria-label": "Link to this paragraph",
            class: "paragraph-link",
            href: `#${id}`,
          },
          tagName: "a",
          type: "element",
        });

        return;
      }

      for (const child of node.children ?? []) {
        visit(child);
      }
    };

    visit(tree);
  };

export const buildBlockIndex = (pages: readonly BlockPage[]) =>
  Effect.forEach((page: BlockPage) => {
    const blocks: ContentBlock[] = [];

    return Effect.tryPromise({
      catch: (cause) => buildError("block index", page.routePath, cause),
      // @effect-diagnostics-next-line asyncFunction:off -- mdsvex owns this build-time Promise parser.
      try: async () =>
        await compile(page.rawText, {
          highlight: false,
          rehypePlugins: [paragraphAnchors(page.rawText, blocks)],
        }),
    }).pipe(
      Effect.map(
        () =>
          [
            page.routePath,
            { blocks, source: page.rawText, title: page.title },
          ] as const
      )
    );
  })(pages).pipe(Effect.map((entries) => new Map(entries)));

export type BlockIndex = Effect.Success<ReturnType<typeof buildBlockIndex>>;
