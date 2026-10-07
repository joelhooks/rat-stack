import { Effect } from "effect";
import {
  Rendered,
  Responded,
  renderToString,
} from "foldkit/experimental/server";

import { ReaderFlags, readerInit } from "./client/reader-model.js";
import { pages } from "./client/reader-pages.js";
import { readerView } from "./features/reader.js";

export const prerenderPaths = [
  "/",
  "/lore/services-capture-dependencies",
  "/featured",
];

// @effect-diagnostics-next-line asyncFunction:off -- Foldkit's Vite host awaits the Web request boundary.
export const renderPage = async (request: Request) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Responded(
      new Response("Reader pages accept GET or HEAD", {
        headers: { Allow: "GET, HEAD" },
        status: 405,
      })
    );
  }

  const page = pages.find(
    (candidate) => candidate.page.path === new URL(request.url).pathname
  );

  if (page === undefined) {
    return Responded(
      new Response("This route is outside the reader preview slice", {
        status: 404,
      })
    );
  }

  const application = await Effect.runPromise(
    renderToString(
      { Flags: ReaderFlags, init: readerInit, view: readerView },
      { flags: page }
    )
  );

  return Rendered(application, { status: page.page.status });
};
