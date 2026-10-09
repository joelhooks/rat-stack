import { Effect, Layer, Option, Schema } from "effect";
import {
  injectIntoTemplate,
  Rendered,
  Responded,
  renderToString,
} from "foldkit/experimental/server";
import { readerErrorShell, readerErrorTemplate } from "virtual:reader-error";
import { readerPageShells } from "virtual:reader-shells";

import {
  ReaderErrorPage,
  readerErrorPath,
} from "../../mischief/src/reader-error-page.js";
import { ReaderFlags, readerInit } from "./client/reader-model.js";
import { pages } from "./client/reader-pages.js";
import { readerView } from "./features/reader.js";
import { isWorkerFirstReaderRoute } from "./reader-routes.js";
import { readerPrerenderOrigin } from "./server/prerender-origin.js";
import { ReaderErrorTemplate } from "./server/reader-error-template.js";
import {
  readerErrorFlags,
  readerErrorShell as errorShellFor,
} from "./server/reader-error.js";
import { WebsiteBindingError } from "./server/website-binding-error.js";
import {
  WebsiteBindings,
  websiteTelemetry,
} from "./server/website-bindings.js";

export const prerenderPaths = pages.map((page) => page.page.path);

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
        return yield* Effect.fail(
          new WebsiteBindingError({
            cause: "Missing PREVIEW_COMMIT",
            message:
              "Preview responses require the full deployed commit binding",
          })
        );
      }

      headers.set("X-Robots-Tag", "noindex");
      headers.set("X-Preview-Commit", commit);
    }

    return headers;
  }
);

const responded = Effect.fn("reader.responded")(function* responded(
  request: Request,
  response: Response
) {
  const headers = new Headers(response.headers);
  const preview = yield* previewHeaders(request);

  for (const [name, value] of preview) {
    headers.set(name, value);
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

    const application = yield* renderToString(
      { Flags: ReaderFlags, init: readerInit, view: readerView },
      { flags: readerErrorFlags(errorTemplate, errorPage.value) }
    );

    const headers = yield* previewHeaders(request);
    headers.set("Content-Type", "text/html; charset=utf-8");

    return Responded(
      new Response(
        injectIntoTemplate(
          errorShellFor(readerErrorShell, errorPage.value),
          application
        ),
        { headers, status: errorPage.value.code }
      )
    );
  }
);

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
    const page = pages.find((candidate) => candidate.page.path === route);

    if (page === undefined) {
      return yield* responded(
        request,
        new Response("This route is outside the reader preview slice", {
          status: 404,
        })
      );
    }

    const promptRoute = isWorkerFirstReaderRoute(route);
    const prerender = new URL(request.url).origin === readerPrerenderOrigin;

    if (
      promptRoute &&
      !prerender &&
      !(request.headers.get("Accept") ?? "").includes("text/html")
    ) {
      return yield* responded(
        request,
        new Response(request.method === "HEAD" ? null : page.agentMarkdown, {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            Vary: "Accept",
          },
          status: page.page.status,
        })
      );
    }

    const application = yield* renderToString(
      { Flags: ReaderFlags, init: readerInit, view: readerView },
      { flags: page }
    );

    const headers = yield* previewHeaders(request);

    const shell = readerPageShells[route];

    if (promptRoute && !prerender) {
      headers.set("Vary", "Accept");
    }

    if (shell !== undefined && !prerender) {
      headers.set("Content-Type", "text/html; charset=utf-8");

      return Responded(
        new Response(injectIntoTemplate(shell, application), {
          headers,
          status: page.page.status,
        })
      );
    }

    if ([...headers].length > 0) {
      return Rendered(application, { headers, status: page.page.status });
    }

    return Rendered(application, { status: page.page.status });
  }
);

// @effect-diagnostics-next-line asyncFunction:off -- Foldkit awaits the Web request boundary.
export const renderPage = async (request: Request) =>
  await Effect.runPromise(
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
