import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Predicate } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { compileReaderBody } from "../../mischief/scripts/reader-body-document.ts";
import { readerLoreFlags } from "../../mischief/scripts/reader-lore-flags.ts";
import { prepareReaderSiteInputs } from "../../mischief/scripts/reader-site-inputs.ts";
import { ReaderFlags, readerInit } from "../src/client/reader-model.js";
import { ReaderNode } from "../src/client/reader-node.js";
import type { ReaderNodeValue } from "../src/client/reader-node.js";
import { readerView } from "../src/features/reader.js";

const normalizedNodes = (
  nodes: readonly ReaderNodeValue[]
): readonly ReaderNodeValue[] => {
  const output: ReaderNodeValue[] = [];

  for (const node of nodes) {
    ReaderNode.$match(node, {
      Element: (element) =>
        output.push(
          ReaderNode.Element({
            ...element,
            attributes: element.attributes.toSorted((left, right) =>
              left.name.localeCompare(right.name)
            ),
            children: normalizedNodes(element.children),
          })
        ),
      Text: ({ value }) => {
        const previous = output.at(-1);

        if (value !== "") {
          if (Predicate.isTagged(previous, "Text")) {
            output[output.length - 1] = ReaderNode.Text({
              value: previous.value + value,
            });
          } else {
            output.push(ReaderNode.Text({ value }));
          }
        }
      },
    });
  }

  return output;
};

it.effect(
  "ReaderSiteParity: every published lore route preserves the complete human body and breadcrumb after Foldkit rendering",
  () =>
    Effect.gen(function* loreParity() {
      const inputs = yield* prepareReaderSiteInputs;

      const pages = inputs.pages.filter(
        (page) => page.path === "/lore" || page.path.startsWith("/lore/")
      );

      const flags = yield* readerLoreFlags("https://ratstack.sh");

      expect(flags.map((page) => page.page.path)).toEqual(
        pages.map((page) => page.path)
      );

      yield* Effect.forEach((page: (typeof flags)[number]) =>
        Effect.gen(function* pageParity() {
          const original = pages.find(
            (candidate) => candidate.path === page.page.path
          );

          expect(original).toBeDefined();

          const before = yield* compileReaderBody(
            original?.html ?? "",
            page.page.sourcePath
          );

          const rendered = yield* renderToString(
            { Flags: ReaderFlags, init: readerInit, view: readerView },
            { flags: page, isHydratable: false }
          );

          const after = yield* compileReaderBody(
            rendered.html,
            page.page.sourcePath
          );

          expect(after.heading, page.page.path).toBe(before.heading);
          expect(after.breadcrumb, page.page.path).toEqual(before.breadcrumb);
          expect(normalizedNodes(after.nodes), page.page.path).toEqual(
            normalizedNodes(before.nodes)
          );
          expect(page.page.generation).toBe(inputs.generation);
          expect(page.page.metadata).toEqual(original?.metadata);
        })
      )(flags);
    }).pipe(Effect.provide(NodeServices.layer))
);
