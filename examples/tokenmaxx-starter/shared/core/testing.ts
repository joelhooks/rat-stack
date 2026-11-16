import { copyFile, cp, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

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

/**
 * The launcher's own package (`scripts/`) and the pieces it imports. A test
 * package that uses `isolatedStarter` lists `@tokenmaxx/scripts` as a
 * dependency, so Turbo reruns it when any of these change.
 */
const launcherDirs = ["scripts", "shared/core", "shared/own-loop"];

/**
 * A copy of the launcher's part of this starter in a temp folder, for a test
 * that runs `pnpm ex` or `pnpm pi`: its package.json and `launcherDirs`
 * (installed links kept as links), with `node_modules` linked. `exercises/`
 * is linked too: the launcher only lists it, for the exercise ids, so a test
 * that starts Pis with it declares every `exercise.ts` as an input.
 *
 * No `.pi/`, no `.workshop-state/`, no `AGENTS.md`, no git: a Pi started
 * there loads none of the guest's own setup in this checkout, and finds none
 * of their live sessions, so the starter's tests test the starter.
 */
export async function isolatedStarter(): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const starter = findRepoRoot();
  const root = await realpath(await mkdtemp(join(tmpdir(), "tmx-starter-")));
  await copyFile(join(starter, "package.json"), join(root, "package.json"));
  await symlink(join(starter, "node_modules"), join(root, "node_modules"));
  await symlink(join(starter, "exercises"), join(root, "exercises"));
  for (const dir of launcherDirs) {
    await cp(join(starter, dir), join(root, dir), {
      recursive: true,
      verbatimSymlinks: true,
      filter: (path) => ![".turbo", ".workshop-state"].includes(basename(path)),
    });
  }
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
