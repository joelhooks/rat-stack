import { Effect } from "effect";
import {
  Rendered,
  Responded,
  renderToString,
} from "foldkit/experimental/server";

import { ReaderFlags, readerInit } from "./client/reader-model.js";
import { pages } from "./client/reader-pages.js";
import { readerView } from "./features/reader.js";
import { WebsiteBindingError } from "./server/website-binding-error.js";
import { WebsiteBindings } from "./server/website-bindings.js";

export const prerenderPaths = pages.map((page) => page.page.path);

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

    const application = yield* renderToString(
      { Flags: ReaderFlags, init: readerInit, view: readerView },
      { flags: page }
    );

    const headers = yield* previewHeaders(request);

    if (headers.has("X-Robots-Tag")) {
      return Rendered(application, { headers, status: page.page.status });
    }

    return Rendered(application, { status: page.page.status });
  }
);

// @effect-diagnostics-next-line asyncFunction:off -- Foldkit awaits the Web request boundary.
export const renderPage = async (request: Request) =>
  await Effect.runPromise(
    renderReaderPage(request).pipe(Effect.provide(WebsiteBindings.layer))
  );
