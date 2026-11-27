import { Effect } from "effect";

import { installReaderTools } from "../web-mcp-boot.js";
import { hydrateDirectory } from "./hydration.js";

import "../../../../site/src/rat.css";
import "../reader.css";

installReaderTools();

Effect.runFork(hydrateDirectory(document));
