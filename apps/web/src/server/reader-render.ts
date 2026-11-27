import { Cause, Effect, Option, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import type { ReaderErrorPage } from "../../../site/src/reader-error-page.js";
import { init } from "../client/reader/init.js";
import { ReaderFlags } from "../client/reader/model.js";
import type { ReaderPageFlags } from "../client/reader/model.js";
import { view } from "../features/reader.js";
import { CafePage } from "../reader-cafe.js";
import type { ReaderSourcePage } from "../reader-cafe.js";
import type * as AllStarsRenderer from "./all-stars-effect-ui.js";
import type * as DirectoryRenderer from "./directory-effect-ui.js";
import type * as NewsRenderer from "./news-effect-ui.js";
import { withReaderHead } from "./reader-document.js";
import type { EffectUiAssets } from "./reader-document.js";
import type { ReaderErrorTemplate } from "./reader-error-template.js";
import { readerErrorFlags } from "./reader-error.js";

class MissingCafe extends Schema.TaggedError<
  MissingCafe,
  { readonly brand: unique symbol }
>()("MissingCafe", {
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

type RenderError = (
  error: typeof ReaderErrorPage.Type
) => ReturnType<typeof renderReaderError>;

const renderCafeOrError = <E>(
  page: ReaderPageFlags,
  label: "News" | "Directory" | "All Stars",
  renderCafe: Effect.Effect<Parameters<typeof withReaderHead>[0], E>,
  renderError: RenderError
) => {
  const { path } = page.page;

  return renderCafe.pipe(
    Effect.map((application) => ({
      application: withReaderHead(application, page),
      status: page.page.status,
    })),
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.interrupt;
      }

      return Effect.logError(
        `${label} HTML could not render`,
        { path },
        cause
      ).pipe(
        Effect.andThen(
          renderError({
            code: 500,
            message: `The ${label.toLowerCase()} page could not load. Try again in a moment.`,
            path,
            title: `${label} could not load`,
          })
        ),
        Effect.map((application) => ({ application, status: 500 }))
      );
    })
  );
};

export const renderNewsOrError = Effect.fn("reader.renderNewsOrError")(
  (
    page: ReaderSourcePage,
    assets: typeof EffectUiAssets.Type,
    loadNews: () => Promise<typeof NewsRenderer>,
    renderError: RenderError
  ) =>
    renderCafeOrError(
      page,
      "News",
      Effect.gen(function* renderNews() {
        const cafe = page.cafe.pipe(Option.filter(CafePage.guards.News));

        if (Option.isNone(cafe)) {
          return yield* new MissingCafe({ path: page.page.path });
        }

        const { renderNewsPage } = yield* Effect.tryPromise(loadNews);

        return yield* renderNewsPage(page, cafe.value, assets);
      }),
      renderError
    )
);

export const renderDirectoryOrError = Effect.fn(
  "reader.renderDirectoryOrError"
)(
  (
    page: ReaderSourcePage,
    assets: typeof EffectUiAssets.Type,
    loadDirectory: () => Promise<typeof DirectoryRenderer>,
    renderError: RenderError
  ) =>
    renderCafeOrError(
      page,
      "Directory",
      Effect.gen(function* renderDirectory() {
        const cafe = page.cafe.pipe(Option.filter(CafePage.guards.Directory));

        if (Option.isNone(cafe)) {
          return yield* new MissingCafe({ path: page.page.path });
        }

        const { renderDirectoryPage } = yield* Effect.tryPromise(loadDirectory);

        return yield* renderDirectoryPage(page, cafe.value, assets);
      }),
      renderError
    )
);

export const renderAllStarsOrError = Effect.fn("reader.renderAllStarsOrError")(
  (
    page: ReaderSourcePage,
    assets: typeof EffectUiAssets.Type,
    loadAllStars: () => Promise<typeof AllStarsRenderer>,
    renderError: RenderError
  ) =>
    renderCafeOrError(
      page,
      "All Stars",
      Effect.gen(function* renderAllStars() {
        const cafe = page.cafe.pipe(Option.filter(CafePage.guards.AllStars));

        if (Option.isNone(cafe)) {
          return yield* new MissingCafe({ path: page.page.path });
        }

        const { renderAllStarsPage } = yield* Effect.tryPromise(loadAllStars);

        return yield* renderAllStarsPage(page, cafe.value, assets);
      }),
      renderError
    )
);
