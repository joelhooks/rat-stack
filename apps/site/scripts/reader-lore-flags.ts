import { Effect, Schema } from "effect";

import { ReaderFlags } from "../../web/src/client/reader/model.js";
import { houseAdCopy } from "../src/house-ad-copy.ts";
import {
  compileReaderBody,
  readerWorkshopCount,
} from "./reader-body-document.ts";
import { prepareReaderSiteInputs } from "./reader-site-inputs.ts";

export const readerLoreFlags = Effect.fn("readerLoreFlags")(
  function* readerLoreFlags(origin: string) {
    const inputs = yield* prepareReaderSiteInputs;

    const pages = inputs.pages.filter(
      (page) => page.path === "/lore" || page.path.startsWith("/lore/")
    );

    return yield* Effect.validate(pages, (page) =>
      Effect.gen(function* lorePage() {
        const body = yield* compileReaderBody(
          page.html.replaceAll("__RATSTACK_ORIGIN__", origin),
          page.sourcePath
        );

        return yield* Schema.decodeUnknownEffect(ReaderFlags)({
          bibliography: [],
          blocks: [],
          bodyNodes: body.nodes,
          breadcrumb: body.breadcrumb,
          codeFences: [],
          copyPrompts: [],
          heading: body.heading,
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
          workshop:
            readerWorkshopCount(page.html) > 0 ? houseAdCopy : undefined,
        });
      })
    );
  }
);
