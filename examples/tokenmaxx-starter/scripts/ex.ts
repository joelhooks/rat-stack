import { findRepoRoot } from "#shared/core/context.ts";

import { runEx } from "./lib/exercises.ts";

// pnpm ex <id> <command> [...args]
process.exitCode = await runEx(process.argv.slice(2), {
  repoRoot: findRepoRoot(),
  io: {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  },
});
