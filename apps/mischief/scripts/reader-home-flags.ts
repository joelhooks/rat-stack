import { Effect } from "effect";
import { DomUtils, parseDocument } from "htmlparser2";

import { houseAdCopy } from "../src/house-ad-copy.ts";
import { copyPrompts } from "./component-data.ts";
import { compileHomeDocument } from "./reader-home-document.ts";
import { ReaderInputError } from "./reader-input-error.ts";
import { prepareReaderSiteInputs } from "./reader-site-inputs.ts";

export const readerHomeFlags = Effect.fn("readerHomeFlags")(
  function* readerHomeFlags(origin: string) {
    const inputs = yield* prepareReaderSiteInputs;
    const page = inputs.pages.find((entry) => entry.path === "/");

    if (page === undefined) {
      return yield* Effect.die(
        new Error("The reader manifest has no home page")
      );
    }

    const home = yield* Effect.try({
      catch: (cause) =>
        new ReaderInputError({
          cause,
          message:
            "Cannot compile the human home source; add a reader renderer for the failing node",
          sourcePath: "apps/mischief/scripts/generate-content.ts",
        }),
      try: () =>
        compileHomeDocument(
          inputs.homeSource.replaceAll("__RATSTACK_ORIGIN__", origin)
        ),
    });

    const sourceDocument = parseDocument(page.html, {
      withEndIndices: true,
      withStartIndices: true,
    });

    const figures = DomUtils.getElementsByTagName(
      "figure",
      sourceDocument.children
    ).filter((element) =>
      (element.attribs.class ?? "").split(/\s+/u).includes("code-snippet")
    );

    const codeFences = yield* Effect.try({
      catch: (cause) =>
        new ReaderInputError({
          cause,
          message:
            "Cannot recover built home excerpt tokens; regenerate content before preparing the reader",
          sourcePath: "/",
        }),
      try: () =>
        DomUtils.getElementsByTagName("pre", sourceDocument.children).map(
          (pre) => {
            const figure =
              figures.find((candidate) =>
                DomUtils.getElementsByTagName(
                  "pre",
                  candidate.children
                ).includes(pre)
              ) ?? pre;

            if (figure.startIndex === null || figure.endIndex === null) {
              throw new ReaderInputError({
                message:
                  "Built home excerpt lacks a bounded source range; regenerate content",
                sourcePath: "/",
              });
            }

            const lines = DomUtils.getElementsByTagName(
              "span",
              figure.children
            ).filter((element) =>
              (element.attribs.class ?? "").split(/\s+/u).includes("code-text")
            );

            return {
              html: page.html
                .slice(figure.startIndex, figure.endIndex + 1)
                .replaceAll("__RATSTACK_ORIGIN__", origin),
              value: (lines.length === 0
                ? DomUtils.textContent(pre)
                    .replace(/^\n/u, "")
                    .replace(/\n$/u, "")
                : lines.map((line) => DomUtils.textContent(line)).join("\n")
              ).replaceAll("__RATSTACK_ORIGIN__", origin),
            };
          }
        ),
    });

    return {
      bibliography: [],
      blocks: home.blocks,
      codeFences,
      copyPrompts: Object.entries(copyPrompts).map(([id, prompt]) => ({
        id,
        label: prompt.label,
        text: prompt.text.replaceAll("__RATSTACK_ORIGIN__", origin),
      })),
      heading: "Rat Stack",
      origin,
      page: {
        generation: inputs.generation,
        metadata: page.metadata,
        path: page.path,
        sourcePath: page.sourcePath,
        status: page.status,
      },
      references: {
        anchors: [],
        backlinks: [],
        inboundCounts: inputs.references.inboundCounts,
      },
      snippets: [],
      terms: [],
      workshop: houseAdCopy,
    };
  }
);
