import { Effect, FileSystem, Path } from "effect";

import { houseAdCopy } from "../src/house-ad-copy.ts";
import { compileReaderBody } from "./reader-body-document.ts";
import { ReaderInputError } from "./reader-input-error.ts";
import { prepareReaderSiteInputs } from "./reader-site-inputs.ts";
import { isSystemsSkillsRoute } from "./reader-systems-skills-routes.ts";
import { contentDates } from "./seo-metadata.ts";

export const readerSystemsSkillsFlags = Effect.fn("readerSystemsSkillsFlags")(
  function* readerSystemsSkillsFlags(origin: string) {
    const inputs = yield* prepareReaderSiteInputs;
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const repository = new URL("../../../", import.meta.url).pathname;

    const pages = inputs.pages.filter((page) =>
      isSystemsSkillsRoute(page.path)
    );

    return yield* Effect.validate(pages, (page) =>
      Effect.gen(function* compileSystemsSkillsPage() {
        const document = yield* compileReaderBody(
          page.html.replaceAll("__RATSTACK_ORIGIN__", origin),
          page.sourcePath
        );

        const source = page.path.startsWith("/systems/")
          ? yield* fs.readFileString(paths.join(repository, page.sourcePath))
          : undefined;

        const dates = yield* Effect.try({
          catch: (cause) =>
            new ReaderInputError({
              cause,
              message:
                "Cannot read system dates; repair the source frontmatter",
              sourcePath: page.sourcePath,
            }),
          try: () =>
            source === undefined ? {} : contentDates(source, page.sourcePath),
        });

        return {
          bibliography: [],
          blocks: [],
          bodyNodes: document.nodes,
          breadcrumb: document.breadcrumb,
          codeFences: [],
          copyPrompts: [],
          heading: document.heading,
          origin,
          page: {
            generation: inputs.generation,
            metadata: { ...page.metadata, ...dates },
            path: page.path,
            sourcePath: page.sourcePath,
            status: page.status,
          },
          snippets: [],
          terms: [],
          workshop: houseAdCopy,
        };
      })
    );
  }
);
