import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

import { gitEnv } from "./git-env.ts";
import { findRepoRoot } from "./repo-root.ts";

// The starter runs in one of two shapes: as a repo of its own, or pulled into
// a guest's repo as a subfolder (usually `workshop/`). The guest root is the
// repo the guest works in either way. Pi runs there, so the guest's own `.pi`
// loads, and checks that look at "your repo" look there. The starter's own
// files and `.workshop-state/` stay where they are (`findRepoRoot`).

/** Exported by `pnpm pi` to Pi and everything it runs: `findGuestRoot()`. */
export const guestRootEnv = "TMX_GUEST_ROOT";

const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/**
 * The repo the guest works in: the top level of the git work tree that holds
 * the starter. The starter root itself, as given, when the starter is its own
 * top level, when no git repo holds it, or when git can't run. A nested
 * result is git's real path. Sync, and it changes nothing.
 */
export function findGuestRoot(
  starterRoot: string = findRepoRoot(),
  env: NodeJS.ProcessEnv = process.env
): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: starterRoot,
    env: gitEnv(env),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 10_000,
  });
  const top = result.status === 0 ? result.stdout.trim() : "";
  return top === "" || real(top) === real(starterRoot) ? starterRoot : top;
}

/** True when the starter sits inside a guest's repo rather than being one. */
export function isNestedStarter(
  starterRoot: string = findRepoRoot(),
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return findGuestRoot(starterRoot, env) !== starterRoot;
}
