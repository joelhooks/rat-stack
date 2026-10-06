import { Effect } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { featuredSites } from "../../mischief/src/capabilities/featured-sites.js";
import { featuredSpec, Flags } from "./client/featured.js";
import { initWithFlags, view } from "./features/app.js";

export const renderPage = Effect.fn("renderPage")(function* renderPage(
  path: string
) {
  const sites = yield* featuredSites.handler({});

  return yield* renderToString(
    { Flags, init: initWithFlags, routing: {}, view },
    {
      flags: {
        featured: { featuredSites: sites, showNote: true, spec: featuredSpec },
      },
      isHydratable: false,
      url: `https://ratstack.sh${path}`,
    }
  );
});

// @effect-diagnostics-next-line asyncFunction:off -- The build-time Vite renderer loads a Promise-returning host entry.
export const renderHome = async () => await Effect.runPromise(renderPage("/"));

// @effect-diagnostics-next-line asyncFunction:off -- The build-time Vite renderer loads a Promise-returning host entry.
export const renderFeatured = async () =>
  await Effect.runPromise(renderPage("/featured"));
