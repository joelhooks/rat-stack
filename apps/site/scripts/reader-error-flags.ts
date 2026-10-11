import { Effect, Schema } from "effect";
import { DomUtils, parseDocument } from "htmlparser2";

import { ReaderErrorTemplate } from "../../web/src/server/reader-error-template.js";
import {
  errorPageTemplates,
  staticAssetGeneration,
} from "../src/bundled-content.generated.ts";
import { renderStaticDocument } from "../src/html.ts";
import {
  compileReaderBody,
  compileReaderNodes,
} from "./reader-body-document.ts";
import { ReaderInputError } from "./reader-input-error.ts";
import {
  documentMetadata,
  prepareReaderSiteInputs,
} from "./reader-site-inputs.ts";

const sourcePath = "apps/site/content/error-page.md";

const fragmentNodes = (html: string, fragmentPath: string) =>
  Effect.try({
    catch: (cause) =>
      new ReaderInputError({
        cause,
        message:
          "Cannot project an error page fragment; repair its generated Markdown",
        sourcePath: fragmentPath,
      }),
    try: () => compileReaderNodes(parseDocument(html).children, fragmentPath),
  });

export const readerErrorTemplate = Effect.fn("readerErrorTemplate")(
  function* readerErrorTemplate(origin: string) {
    const inputs = yield* prepareReaderSiteInputs;

    if (staticAssetGeneration !== inputs.generation) {
      return yield* new ReaderInputError({
        message:
          "The bundled error page templates and the content manifest have different generations; regenerate content before building the reader",
        sourcePath: "apps/site/src/bundled-content.generated.ts",
      });
    }

    const html = renderStaticDocument(origin, errorPageTemplates.documentHtml);
    const body = yield* compileReaderBody(html, sourcePath);

    const hasStructuredData = DomUtils.getElementsByTagName(
      "script",
      parseDocument(html).children
    ).some((element) => element.attribs.type === "application/ld+json");

    const metadata = documentMetadata("/", errorPageTemplates.documentHtml);

    return yield* Schema.decodeUnknownEffect(ReaderErrorTemplate)({
      actions: yield* fragmentNodes(
        errorPageTemplates.actionsHtml,
        "error-actions.md"
      ),
      noVerifyDetails: yield* fragmentNodes(
        errorPageTemplates.noVerifyDetails.html,
        "apps/site/scripts/generate-content.ts"
      ),
      page: {
        bibliography: [],
        blocks: [],
        bodyNodes: body.nodes,
        codeFences: [],
        copyPrompts: [],
        heading: body.heading,
        origin,
        page: {
          generation: inputs.generation,
          metadata: {
            ...metadata,
            jsonLd: hasStructuredData ? metadata.jsonLd : "none",
          },
          path: "/",
          sourcePath,
          status: 500,
        },
        snippets: [],
        terms: [],
      },
      suggestion: yield* fragmentNodes(
        errorPageTemplates.suggestionHtml,
        "error-suggestion.md"
      ),
    });
  }
);
