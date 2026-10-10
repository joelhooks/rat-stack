import { Effect, Schema } from "effect";

import {
  initialModel,
  Model as DocsModel,
} from "../../web/src/client/docs/model.ts";
import { searchCopy } from "../../web/src/features/docs-copy.ts";
import { ReaderInputError } from "./reader-input-error.ts";
import { prepareReaderSiteInputs } from "./reader-site-inputs.ts";

const searchPath = "/search";

const searchSourcePath = "apps/web/src/features/app.ts";

export const readerSearchFlags = Effect.fn("readerSearchFlags")(
  function* readerSearchFlags(origin: string) {
    const inputs = yield* prepareReaderSiteInputs;
    const descriptor = inputs.pages.find((entry) => entry.path === searchPath);

    if (descriptor === undefined) {
      return yield* new ReaderInputError({
        message: `The content manifest has no ${searchPath} page; regenerate content before preparing the reader`,
        sourcePath: searchSourcePath,
      });
    }

    return {
      agentMarkdown: undefined,
      bibliography: [],
      blocks: [],
      codeFences: [],
      copyPrompts: [],
      docs: yield* Schema.encodeEffect(DocsModel)(initialModel),
      heading: searchCopy.heading,
      origin,
      page: {
        generation: inputs.generation,
        metadata: descriptor.metadata,
        path: searchPath,
        sourcePath: searchSourcePath,
        status: 200,
      },
      snippets: [],
      terms: [],
    };
  }
);
