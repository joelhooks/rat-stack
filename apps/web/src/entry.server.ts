import { Effect } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { init, view } from "./features/app.js";

// @effect-diagnostics-next-line asyncFunction:off -- The build-time Vite renderer loads a Promise-returning host entry.
export const renderHome = async () =>
  await Effect.runPromise(
    renderToString(
      { init, routing: {}, view },
      { isHydratable: false, url: "https://ratstack.sh/" }
    )
  );
