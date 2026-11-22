import { findRepoRoot } from "#shared/core/context.ts";

import { installHooks } from "./lib/hooks.ts";

// pnpm install runs this (`prepare`): the commit hook, where git allows it.
// It never fails the install.
try {
  console.log(installHooks(findRepoRoot()).message);
} catch (error) {
  console.log(`No commit hook: ${String(error)}`);
}
