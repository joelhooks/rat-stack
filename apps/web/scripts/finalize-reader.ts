import { NodeRuntime } from "@effect/platform-node";

import { finalizeReader } from "./reader-build.ts";

NodeRuntime.runMain(
  finalizeReader(process.cwd(), `${process.cwd()}/dist/client`)
);
