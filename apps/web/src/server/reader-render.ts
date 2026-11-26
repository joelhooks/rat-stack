import { Effect, Option, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import type { ReaderErrorPage } from "../../../site/src/reader-error-page.js";
import { Model as CafeModel } from "../client/cafe/model.js";
import { init } from "../client/reader/init.js";
import { ReaderFlags } from "../client/reader/model.js";
import type { ReaderPageFlags } from "../client/reader/model.js";
import { view } from "../features/reader.js";
import type * as NewsRenderer from "./news-effect-ui.js";
import { withReaderHead } from "./reader-document.js";
import type { NewsDocumentAssets } from "./reader-document.js";
import type { ReaderErrorTemplate } from "./reader-error-template.js";
import { readerErrorFlags } from "./reader-error.js";

class MissingNews extends Schema.TaggedError<
  MissingNews,
  { readonly brand: unique symbol }
>()("MissingNews", {
  path: Schema.String,
}) {}

export const renderReaderApplication = (
  page: ReaderPageFlags,
  buildId?: string
) =>
  renderToString(
    { Flags: ReaderFlags, init, view },
    buildId === undefined ? { flags: page } : { flags: page, buildId }
  ).pipe(Effect.map((application) => withReaderHead(application, page)));

export const renderReaderError = (
  template: typeof ReaderErrorTemplate.Type,
  error: typeof ReaderErrorPage.Type,
  buildId?: string
) => renderReaderApplication(readerErrorFlags(template, error), buildId);

export const renderNewsOrError = Effect.fn("reader.renderNewsOrError")(
  function* renderNewsOrError(
    page: ReaderPageFlags,
    assets: typeof NewsDocumentAssets.Type,
    loadNews: () => Promise<typeof NewsRenderer>,
    renderError: (
      error: typeof ReaderErrorPage.Type
    ) => ReturnType<typeof renderReaderError>
  ) {
    const { path } = page.page;
    const cafe = page.cafe.pipe(Option.filter(CafeModel.guards.News));

    return yield* Effect.gen(function* renderNews() {
      if (Option.isNone(cafe)) {
        return yield* new MissingNews({ path });
      }

      const { renderNewsPage } = yield* Effect.tryPromise(loadNews);
      const application = yield* renderNewsPage(page, cafe.value, assets);

      return {
        application: withReaderHead(application, page),
        status: page.page.status,
      };
    }).pipe(
      Effect.catch((error) =>
        Effect.logError("News HTML could not render", { path, error }).pipe(
          Effect.andThen(
            renderError({
              code: 500,
              message: "The news page could not load. Try again in a moment.",
              path,
              title: "News could not load",
            })
          ),
          Effect.map((application) => ({ application, status: 500 }))
        )
      )
    );
  }
);
