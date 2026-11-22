import { findRepoRoot } from "#shared/core/context.ts";

import { runEx } from "./lib/exercises.ts";
import { ensureHooks } from "./lib/hooks.ts";

// pnpm ex <id> <command> [...args]
const repoRoot = findRepoRoot();
ensureHooks(repoRoot, (line) => console.error(line));
process.exitCode = await runEx(process.argv.slice(2), {
  repoRoot,
  io: {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  },
});
