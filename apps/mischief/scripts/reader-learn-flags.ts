import { Effect, FileSystem, Path } from "effect";

import { copyPrompts } from "./component-data.ts";
import { lawSpecs } from "./content-specs.ts";
import { compileReaderDocument } from "./reader-home-document.ts";
import { ReaderInputError } from "./reader-input-error.ts";
import { prepareReaderSiteInputs } from "./reader-site-inputs.ts";
import { scanLeadingFrontmatterFence } from "./svx-ast.ts";

export const learnRoutePath = "/learn";

export const readerLearnFlags = Effect.fn("readerLearnFlags")(
  function* readerLearnFlags(origin: string) {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const inputs = yield* prepareReaderSiteInputs;
    const spec = lawSpecs.find((entry) => entry.routePath === learnRoutePath);
    const page = inputs.pages.find((entry) => entry.path === learnRoutePath);

    if (spec === undefined || page === undefined) {
      return yield* new ReaderInputError({
        message:
          "The learn page is missing from the content specs or manifest; register /learn in content-specs.ts and regenerate content",
        sourcePath: "apps/mischief/scripts/content-specs.ts",
      });
    }

    const raw = yield* fs.readFileString(
      paths.join(
        new URL("../../../", import.meta.url).pathname,
        spec.sourcePath
      )
    );

    const learn = yield* Effect.try({
      catch: (cause) =>
        new ReaderInputError({
          cause,
          message:
            "Cannot compile the learn page source; keep it to headings, paragraphs, lists, and known CopyPrompt ids",
          sourcePath: spec.sourcePath,
        }),
      try: () =>
        compileReaderDocument(
          scanLeadingFrontmatterFence(raw, spec.sourcePath).body,
          inputs.loreTermTargets,
          { heading: spec.title, route: learnRoutePath }
        ),
    });

    return {
      bibliography: [],
      blocks: learn.blocks,
      codeFences: [],
      copyPrompts: Object.entries(copyPrompts).map(([id, prompt]) => ({
        id,
        label: prompt.label,
        showText: prompt.showText,
        text: prompt.text.replaceAll("__RATSTACK_ORIGIN__", origin),
      })),
      heading: spec.title,
      origin,
      page: {
        generation: inputs.generation,
        metadata: page.metadata,
        path: page.path,
        sourcePath: spec.sourcePath,
        status: page.status,
      },
      references: {
        anchors: [],
        backlinks: [],
        inboundCounts: inputs.references.inboundCounts,
      },
      snippets: [],
      terms: [],
    };
  }
);
