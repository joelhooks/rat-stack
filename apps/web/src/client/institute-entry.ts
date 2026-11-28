import { Effect } from "effect";

import { hydrateInstitute } from "../institute/routes/hydration.js";

import "../../../site/src/rat.css";
import "../institute/routes/institute.css";

Effect.runFork(
  hydrateInstitute(document, (host, slot) =>
    Effect.tryPromise(() => import("./institute-playback.js")).pipe(
      Effect.flatMap(({ mountChapter }) => mountChapter(host, slot))
    )
  ).pipe(
    Effect.scoped,
    Effect.tapCause((cause) =>
      Effect.logError("Institute hydration failed", cause)
    )
  )
);
