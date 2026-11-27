import { Effect } from "effect";

import { installReaderTools } from "../web-mcp-boot.js";
import { hydrateAllStars } from "./hydration.js";

import "../../../../site/src/rat.css";
import "../reader.css";

installReaderTools();

Effect.runFork(hydrateAllStars(document));
