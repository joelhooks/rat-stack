import { findRepoRoot } from "#shared/core/context.ts";

import { fold, pickDelay, publish, readEvents } from "./job.ts";

// node finish-later.ts <stateDir> <runId> <maxMs> [minMs]
//
// The job's timer, started detached by `pnpm ex <id> start`. It waits a
// random time it picks here and tells nobody, then finishes the run. It
// looks at the job every second and exits early once the run has finished
// some other way (`release`) or is gone (`setup`, or the state dir was
// removed), so a released run leaves no process behind.

async function finishLater(stateDir: string, runId: string, deadline: number) {
  for (;;) {
    const run = fold(await readEvents(stateDir)).runs.find(
      (r) => r.runId === runId
    );
    if (run === undefined || run.result !== null) {
      return;
    }
    const left = deadline - Date.now();
    if (left <= 0) {
      await publish(stateDir, findRepoRoot(), runId);
      return;
    }
    await new Promise((wake) => setTimeout(wake, Math.min(1000, left)));
  }
}

const [stateDir, runId, maxMs, minMs] = process.argv.slice(2);
if (stateDir === undefined || runId === undefined || maxMs === undefined) {
  console.error("usage: finish-later.ts <stateDir> <runId> <maxMs> [minMs]");
  process.exit(2);
}
const delay = pickDelay(
  Number(maxMs),
  Math.random(),
  minMs === undefined ? undefined : Number(minMs)
);
await finishLater(stateDir, runId, Date.now() + delay);
