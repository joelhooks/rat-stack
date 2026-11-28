import { Effect } from "effect";

import { hydrateInstitute } from "../institute/routes/hydration.js";

import "../../../site/src/rat.css";
import "../institute/routes/institute.css";

Effect.runFork(
  hydrateInstitute(document).pipe(
    Effect.scoped,
    Effect.tapCause((cause) =>
      Effect.logError("Institute hydration failed", cause)
    )
  )
);
