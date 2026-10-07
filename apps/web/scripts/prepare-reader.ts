import { NodeRuntime } from "@effect/platform-node";

import { prepareReader } from "./reader-build.ts";

NodeRuntime.runMain(prepareReader(process.cwd()));
