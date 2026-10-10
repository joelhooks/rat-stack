import { NodeRuntime } from "@effect/platform-node";
import { eventFlags } from "@rat-stack/core/flags";

import { checkFlagExpiry } from "./expiry.js";

NodeRuntime.runMain(checkFlagExpiry(eventFlags));
