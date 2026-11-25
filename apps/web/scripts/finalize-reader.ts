import { NodeRuntime } from "@effect/platform-node";

import { finalizePrerender } from "./reader-build.ts";

NodeRuntime.runMain(
  finalizePrerender(
    process.cwd(),
    `${process.cwd()}/dist/client`,
    `${process.cwd()}/dist/server`
  )
);
