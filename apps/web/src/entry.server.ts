import { Effect, Layer, Option, Schema } from "effect";
import {
  Rendered,
  Responded,
  handleRequest,
  toResponse,
} from "foldkit/experimental/server";
import type { DocumentRenderer } from "foldkit/experimental/server";
import effectUiAssetManifest from "virtual:reader-effect-ui-assets";
import { readerErrorTemplate } from "virtual:reader-error";

import {
  ReaderErrorPage,
  readerErrorPath,
} from "../../site/src/reader-error-page.js";
import { newsOrder } from "./features/cafe/news-order.js";
import {
  allStarsRouter,
  directoryRouter,
  isWithinSection,
  loreRouter,
} from "./features/site-route.js";
import { isInstitutePath } from "./institute/routes/paths.js";
import { instituteWebsiteRuntime } from "./institute/routes/website-runtime.js";
import type { ReaderSourcePage } from "./reader-cafe.js";
import { isWorkerFirstReaderRoute } from "./reader-routes.js";
import { readerPrerenderOrigin } from "./server/prerender-origin.js";
import { EffectUiAssets, renderDocument } from "./server/reader-document.js";
import { readerSupportsEffectUi } from "./server/reader-effect-ui-props.js";
import { ReaderErrorTemplate } from "./server/reader-error-template.js";
import { findPage } from "./server/reader-pages.js";
import {
  renderAllStarsOrError,
  renderDirectoryOrError,
  renderNewsOrError,
  renderReaderApplication,
  renderReaderError,
} from "./server/reader-render.js";
import { WebsiteBindingError } from "./server/website-binding-error.js";
import {
  WebsiteBindings,
  websiteTelemetry,
} from "./server/website-bindings.js";

export { pagePaths as prerenderPaths } from "./server/reader-pages.js";

export { renderDocument };

const effectUiAssets = Schema.decodeUnknownSync(
  Schema.Struct({
    "all-stars-effect-ui": EffectUiAssets,
    "directory-effect-ui": EffectUiAssets,
    "institute-effect-ui": EffectUiAssets,
    "news-effect-ui": EffectUiAssets,
    "reader-effect-ui": EffectUiAssets,
  })
)(effectUiAssetManifest);

const errorTemplate =
  Schema.decodeUnknownSync(ReaderErrorTemplate)(readerErrorTemplate);

const decodeErrorPage = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ReaderErrorPage)
);

const previewHeaders = Effect.fn("reader.previewHeaders")(
  function* previewHeaders(request: Request) {
    const headers = new Headers();

    if (/^pr-[1-9][0-9]*\.ratstack\.sh$/u.test(new URL(request.url).hostname)) {
      const bindings = yield* WebsiteBindings;
      const commit = yield* bindings.previewCommit;

      if (commit === undefined) {
        return yield* new WebsiteBindingError({
          cause: "Missing PREVIEW_COMMIT",
          message: "Preview responses require the full deployed commit binding",
        });
      }

      headers.set("X-Robots-Tag", "noindex");
      headers.set("X-Preview-Commit", commit);
    }

    return headers;
  }
);

const responded = Effect.fn("reader.responded")(function* responded(
  request: Request,
  response: Response,
  noindex?: boolean
) {
  const headers = new Headers(response.headers);
  const preview = yield* previewHeaders(request);

  for (const [name, value] of preview) {
    headers.set(name, value);
  }

  if (noindex === true) {
    headers.set("X-Robots-Tag", "noindex");
  }

  return Responded(
    new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    })
  );
});

const renderErrorRoute = Effect.fn("reader.renderErrorRoute")(
  function* renderErrorRoute(request: Request) {
    if (request.method !== "POST") {
      return yield* responded(
        request,
        new Response("Error pages accept POST", {
          headers: { Allow: "POST" },
          status: 405,
        })
      );
    }

    const errorPage = yield* Effect.tryPromise(request.text.bind(request)).pipe(
      Effect.flatMap(decodeErrorPage),
      Effect.option
    );

    if (Option.isNone(errorPage)) {
      return yield* responded(
        request,
        new Response("Error pages need a ReaderErrorPage JSON body", {
          status: 400,
        })
      );
    }

    const application = yield* renderReaderError(
      errorTemplate,
      errorPage.value
    );

    const headers = yield* previewHeaders(request);

    return Rendered(application, { headers, status: errorPage.value.code });
  }
);

const renderErrorApplication = (error: typeof ReaderErrorPage.Type) =>
  renderReaderError(errorTemplate, error);

const renderReaderHtml = (page: ReaderSourcePage) => {
  const { path, status } = page.page;

  if (path === newsOrder.rank.href || path === newsOrder.newest.href) {
    return renderNewsOrError(
      page,
      effectUiAssets["news-effect-ui"],
      () => import("./server/news-effect-ui.js"),
      renderErrorApplication
    );
  }

  if (path === directoryRouter()) {
    return renderDirectoryOrError(
      page,
      effectUiAssets["directory-effect-ui"],
      () => import("./server/directory-effect-ui.js"),
      renderErrorApplication
    );
  }

  if (path === allStarsRouter()) {
    return renderAllStarsOrError(
      page,
      effectUiAssets["all-stars-effect-ui"],
      () => import("./server/all-stars-effect-ui.js"),
      renderErrorApplication
    );
  }

  if (isWithinSection(loreRouter(), path) && readerSupportsEffectUi(page)) {
    return Effect.tryPromise(
      () => import("./server/reader-effect-ui-page.js")
    ).pipe(
      Effect.flatMap(({ renderEffectUiReader }) =>
        renderEffectUiReader(page, effectUiAssets["reader-effect-ui"])
      ),
      Effect.map((application) => ({ application, status }))
    );
  }

  return renderReaderApplication(page).pipe(
    Effect.map((application) => ({ application, status }))
  );
};

const notFound = (request: Request, noindex = false) =>
  responded(
    request,
    new Response("This route is outside the reader preview slice", {
      status: 404,
    }),
    noindex
  );

const institutePage = Effect.fn("reader.institutePage")(function* institutePage(
  request: Request
) {
  const institute = yield* instituteWebsiteRuntime;

  if (institute === null) {
    return yield* notFound(request);
  }

  const { discoverable, fetchAsset } = institute;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return yield* responded(
      request,
      new Response("Institute pages accept GET or HEAD", {
        headers: { Allow: "GET, HEAD" },
        status: 405,
      }),
      !discoverable
    );
  }

  const { renderInstituteRequest } = yield* Effect.tryPromise(
    () => import("./institute/routes/request.js")
  );

  const result = yield* renderInstituteRequest(
    request,
    fetchAsset,
    effectUiAssets["institute-effect-ui"],
    discoverable
  ).pipe(
    Effect.catch((error) =>
      Effect.logError("Institute published content unavailable", error).pipe(
        Effect.as({
          response: new Response("Institute content is unavailable", {
            status: 503,
          }),
        })
      )
    )
  );

  if (result === null) {
    return yield* notFound(request, !discoverable);
  }

  if (result.response !== undefined) {
    return yield* responded(request, result.response, !discoverable);
  }

  const headers = yield* previewHeaders(request);

  if (!discoverable) {
    headers.set("X-Robots-Tag", "noindex");
  }

  return Rendered(result.application, { headers, status: 200 });
});

export const renderReaderPage = Effect.fn("reader.renderPage")(
  function* renderReaderPage(request: Request) {
    const { pathname } = new URL(request.url);

    if (pathname === "/__rat" || pathname.startsWith("/__rat/")) {
      return yield* responded(
        request,
        new Response("Not found", { status: 404 })
      );
    }

    if (pathname === "/rpc" || pathname.startsWith("/rpc/")) {
      const bindings = yield* WebsiteBindings;

      return yield* responded(request, yield* bindings.forward(request));
    }

    if (pathname === readerErrorPath) {
      return yield* renderErrorRoute(request);
    }

    if (isInstitutePath(pathname)) {
      return yield* institutePage(request);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return yield* responded(
        request,
        new Response("Reader pages accept GET or HEAD", {
          headers: { Allow: "GET, HEAD" },
          status: 405,
        })
      );
    }

    const route = pathname === "/" ? pathname : pathname.replace(/\/$/u, "");
    const found = yield* findPage(route);

    if (Option.isNone(found)) {
      return yield* notFound(request);
    }

    const page = found.value;
    const promptRoute = isWorkerFirstReaderRoute(route);
    const prerender = new URL(request.url).origin === readerPrerenderOrigin;

    if (
      promptRoute &&
      !prerender &&
      !(request.headers.get("Accept") ?? "").includes("text/html")
    ) {
      return yield* responded(
        request,
        new Response(
          request.method === "HEAD"
            ? null
            : Option.getOrNull(page.agentMarkdown),
          {
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              Vary: "Accept",
            },
            status: page.page.status,
          }
        )
      );
    }

    const headers = yield* previewHeaders(request);

    if (promptRoute && !prerender) {
      headers.set("Vary", "Accept");
    }

    const { application, status } = yield* renderReaderHtml(page);

    return Rendered(application, prerender ? { status } : { headers, status });
  }
);

export const renderPage = (request: Request) =>
  Effect.runPromise(
    renderReaderPage(request).pipe(
      Effect.provide(
        Layer.mergeAll(
          WebsiteBindings.layer,
          new URL(request.url).origin === readerPrerenderOrigin
            ? Layer.empty
            : websiteTelemetry
        )
      )
    )
  );

export const renderWebsiteRequest = (
  request: Request,
  assets: Parameters<DocumentRenderer>[1]
) => {
  const document = (application: Parameters<DocumentRenderer>[0]) =>
    renderDocument(application, assets);

  if (!isInstitutePath(new URL(request.url).pathname)) {
    return handleRequest(request, { renderDocument: document, renderPage });
  }

  return renderPage(request).then((result) => {
    const response = toResponse(document, result);

    if (request.method !== "HEAD" || response.body === null) {
      return response;
    }

    return response.body.cancel().then(() => new Response(null, response));
  });
};
