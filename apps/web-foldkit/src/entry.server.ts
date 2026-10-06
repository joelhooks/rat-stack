import { Effect } from "effect";
import { renderToString, Rendered } from "foldkit/experimental/server";
import type { EntryResult } from "foldkit/experimental/server";

import { init, view } from "./features/app.js";

export const prerenderPaths: readonly string[] = ["/"];

// @effect-diagnostics-next-line asyncFunction:off -- Foldkit's Vite server entry requires a Promise at the host boundary.
export const renderPage = async (request: Request): Promise<EntryResult> =>
  await Effect.runPromise(
    renderToString({ init, routing: {}, view }, { url: request.url }).pipe(
      Effect.map(Rendered)
    )
  );
