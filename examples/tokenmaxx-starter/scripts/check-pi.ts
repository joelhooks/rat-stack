import { findRepoRoot } from "#shared/core/context.ts";

import {
  checkPinnedPackage,
  checkPiTurn,
  formatResult,
} from "./lib/pi-check.ts";

// pnpm check:pi: one real Pi turn with a built-in tool call, and the pinned
// package on disk at its commit.
const repoRoot = findRepoRoot();
const results = [await checkPiTurn(repoRoot), checkPinnedPackage(repoRoot)];
for (const result of results) {
  for (const line of formatResult(result)) {
    console.log(line);
  }
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
