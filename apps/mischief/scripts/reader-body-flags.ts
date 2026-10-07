import { Effect, Schema } from "effect";

import { ReaderFlags } from "../../web/src/client/reader-model.js";
import { readerBodyRoutePaths } from "../../web/src/reader-routes.js";
import { houseAdCopy } from "../src/house-ad-copy.ts";
import {
  compileReaderBody,
  readerWorkshopCount,
} from "./reader-body-document.ts";
import { ReaderInputError } from "./reader-input-error.ts";
import { prepareReaderSiteInputs } from "./reader-site-inputs.ts";

export const readerBodyFlags = Effect.fn("readerBodyFlags")(
  function* readerBodyFlags(origin: string) {
    const inputs = yield* prepareReaderSiteInputs;

    const pages = inputs.pages.filter((page) =>
      readerBodyRoutePaths.includes(page.path)
    );

    const missing = readerBodyRoutePaths.filter(
      (path) => !pages.some((page) => page.path === path)
    );

    if (missing.length > 0) {
      return yield* new ReaderInputError({
        message: `Reader routes are missing from the content manifest: ${missing.join(", ")}; regenerate content or remove them from readerBodyRoutePaths`,
        sourcePath: "apps/web/src/reader-routes.ts",
      });
    }

    return yield* Effect.validate(pages, (page) =>
      Effect.gen(function* bodyPage() {
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
