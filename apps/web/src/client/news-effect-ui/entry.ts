import { Effect } from "effect";

import { installReaderTools } from "../web-mcp-boot.js";
import { hydrateNews } from "./hydration.js";

import "../../../../site/src/rat.css";
import "../reader.css";

installReaderTools();

Effect.runFork(
  hydrateNews(document).pipe(
    Effect.scoped,
    Effect.tapCause((cause) => Effect.logError("News hydration failed", cause))
  )
);
