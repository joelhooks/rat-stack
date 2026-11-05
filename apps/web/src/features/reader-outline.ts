import { Array, Match, Option, pipe } from "effect";

import type { ReaderNodeValue } from "../client/reader-node.js";
import type { ReaderModel } from "../client/reader/model.js";

export interface OutlineEntry {
  readonly id: string;
  readonly landmark: boolean;
  readonly level: 2 | 3;
  readonly text: string;
}

const isParagraphLink = (
  attributes: readonly { readonly name: string; readonly value: string }[]
) =>
  attributes.some(
    (attribute) =>
      attribute.name === "class" &&
      attribute.value.split(/\s+/u).includes("paragraph-link")
  );

const nodeText: (node: ReaderNodeValue) => string =
  Match.type<ReaderNodeValue>().pipe(
    Match.tagsExhaustive({
      CopyPrompt: () => "",
      Element: (element) =>
        element.tag === "sup" || isParagraphLink(element.attributes)
          ? ""
          : element.children.map(nodeText).join(""),
      Text: (text) => text.value,
    })
  );

const headingEntry = (
  element: Extract<ReaderNodeValue, { readonly _tag: "Element" }>
): readonly OutlineEntry[] => {
  const id = element.attributes.find((attribute) => attribute.name === "id");

  return id === undefined
    ? []
    : [
        {
          id: id.value,
          landmark: false,
          level: element.tag === "h2" ? 2 : 3,
          text: nodeText(element).trim(),
        },
      ];
};

const nodeEntries: (node: ReaderNodeValue) => readonly OutlineEntry[] =
  Match.type<ReaderNodeValue>().pipe(
    Match.tag("Element", (element) =>
      element.tag === "h2" || element.tag === "h3"
        ? headingEntry(element)
        : element.children.flatMap(nodeEntries)
    ),
    Match.orElse(() => [])
  );

const blockEntry: (
  block: ReaderModel["blocks"][number]
) => readonly OutlineEntry[] = Match.type<ReaderModel["blocks"][number]>().pipe(
  Match.tag("Heading", (heading): readonly OutlineEntry[] =>
    (heading.level ?? 2) <= 3
      ? [
          {
            id: heading.id,
            landmark: false,
            level: heading.level === 3 ? 3 : 2,
            text: heading.title,
          },
        ]
      : []
  ),
  Match.orElse(() => [])
);

const blockEntries = (model: ReaderModel): readonly OutlineEntry[] =>
  model.blocks.flatMap(blockEntry);

const trailingEntries = (model: ReaderModel): readonly OutlineEntry[] => [
  ...(Array.isReadonlyArrayNonEmpty(model.bibliography)
    ? [{ id: "sources", landmark: true, level: 2 as const, text: "Sources" }]
    : []),
  ...Option.match(model.references, {
    onNone: () => [],
    onSome: (references) =>
      Array.isReadonlyArrayNonEmpty(references.backlinks)
        ? [
            {
              id: "linked-from",
              landmark: true,
              level: 2 as const,
              text: "Referenced by",
            },
          ]
        : [],
  }),
];

export const pageOutline = (model: ReaderModel): readonly OutlineEntry[] =>
  Array.dedupeWith(
    [
      ...Option.match(model.bodyNodes, {
        onNone: () => [],
        onSome: (nodes) => nodes.flatMap(nodeEntries),
      }),
      ...blockEntries(model),
      ...trailingEntries(model),
    ].filter((entry) => entry.text !== ""),
    (left, right) => left.id === right.id
  );

export interface OutlineGroup {
  readonly children: readonly OutlineEntry[];
  readonly entry: OutlineEntry;
}

const startsGroup = (entries: readonly OutlineEntry[], index: number) =>
  entries[index]?.level === 2 ||
  !entries.slice(0, index).some((entry) => entry.level === 2);

export const outlineTree = (
  entries: readonly OutlineEntry[]
): readonly OutlineGroup[] =>
  entries.flatMap((entry, index) =>
    startsGroup(entries, index)
      ? [
          {
            children:
              entry.level === 2
                ? pipe(
                    entries.slice(index + 1),
                    Array.takeWhile((child) => child.level === 3)
                  )
                : [],
            entry,
          },
        ]
      : []
  );
