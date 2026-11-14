import { findRepoRoot } from "#shared/core/context.ts";

import { prepareOffline } from "./lib/offline.ts";

// pnpm offline:prepare: the pinned package in .pi/git/ (online, once),
// then a saved trust decision for this folder. Safe to rerun offline.
process.exitCode = prepareOffline(findRepoRoot(), {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
