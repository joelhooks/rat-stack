import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type ExerciseContext,
  exerciseContext,
  findRepoRoot,
} from "./context.ts";

/**
 * A context whose state dir is a fresh temp dir. Call `cleanup` in `afterEach`.
 * Tests never touch `.workshop-state/`.
 */
export async function tempContext(
  opts: { exerciseId?: string } = {}
): Promise<{ ctx: ExerciseContext; cleanup: () => Promise<void> }> {
  const stateDir = await mkdtemp(join(tmpdir(), "tmx-test-"));
  const ctx = exerciseContext({
    exerciseId: opts.exerciseId ?? "00.0",
    repoRoot: findRepoRoot(),
    env: { TMX_STATE_DIR: stateDir },
  });
  return {
    ctx,
    cleanup: () => rm(stateDir, { recursive: true, force: true }),
  };
}
