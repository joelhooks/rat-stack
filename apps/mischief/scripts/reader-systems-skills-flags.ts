import { Effect } from "effect";

import { houseAdCopy } from "../src/house-ad-copy.ts";
import { compileReaderBody } from "./reader-body-document.ts";
import { prepareReaderSiteInputs } from "./reader-site-inputs.ts";
import { isSystemsSkillsRoute } from "./reader-systems-skills-routes.ts";

export const readerSystemsSkillsFlags = Effect.fn("readerSystemsSkillsFlags")(
  function* readerSystemsSkillsFlags(origin: string) {
    const inputs = yield* prepareReaderSiteInputs;

    const pages = inputs.pages.filter((page) =>
      isSystemsSkillsRoute(page.path)
    );

    return yield* Effect.validate(pages, (page) =>
      Effect.gen(function* compileSystemsSkillsPage() {
        const document = yield* compileReaderBody(
          page.html.replaceAll("__RATSTACK_ORIGIN__", origin),
          page.sourcePath
        );

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
            metadata: page.metadata,
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
