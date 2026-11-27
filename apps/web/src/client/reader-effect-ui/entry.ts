import { Effect } from "effect";

import { installReaderTools } from "../web-mcp-boot.js";
import { hydrateReader } from "./hydration.js";

import "../../../../site/src/rat.css";
import "../reader.css";

installReaderTools();

Effect.runFork(hydrateReader(document));
