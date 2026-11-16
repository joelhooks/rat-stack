import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

import { gitEnv } from "#shared/core/git-env.ts";

// The starter's commit hook: `.githooks/prepare-commit-msg` runs `pnpm check`
// on every commit. This points git at it, but only in a git repository whose
// top is the starter's own folder. A copy with no git gets no hook, and a
// starter inside another repo never touches that repo's hooks. `pnpm install`
// runs it, and so do `pnpm ex` and `pnpm pi`, so a copy that becomes a git
// repo after its install gets the hook on its next command.

export const hooksPath = ".githooks";

export type HookResult = {
  /** True when this call set `core.hooksPath`. */
  readonly changed: boolean;
  readonly message: string;
};

const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

export function installHooks(root: string): HookResult {
  const git = (args: readonly string[]) =>
    spawnSync("git", args, { cwd: root, encoding: "utf8", env: gitEnv() });
  const same = (message: string): HookResult => ({ changed: false, message });
  const top = git(["rev-parse", "--show-toplevel"]);
  if (top.error !== undefined || top.status !== 0) {
    return same(
      "No git repository here, so no commit hook yet. After `git init`, the next `pnpm install`, `pnpm ex` or `pnpm pi` turns it on."
    );
  }
  const topDir = top.stdout.trim();
  if (real(topDir) !== real(root)) {
    return same(
      `Inside the repository at ${topDir}: its hooks are left alone.`
    );
  }
  const current = git(["config", "--local", "--get", "core.hooksPath"]);
  const set = current.status === 0 ? current.stdout.trim() : "";
  if (set === hooksPath) {
    return same(
      `Commit hook on: ${hooksPath}/prepare-commit-msg runs \`pnpm check\` on every commit.`
    );
  }
  if (set !== "") {
    return same(
      `core.hooksPath is already ${set}, so it was left alone. The starter's hook is ${hooksPath}/prepare-commit-msg.`
    );
  }
  const done = git(["config", "--local", "core.hooksPath", hooksPath]);
  return done.status === 0
    ? {
        changed: true,
        message: `Commit hook on: ${hooksPath}/prepare-commit-msg runs \`pnpm check\` on every commit.`,
      }
    : same(`Couldn't set core.hooksPath: ${done.stderr.trim()}`);
}

/** For `pnpm ex` and `pnpm pi`: says something only when it turned the hook on. Never throws. */
export function ensureHooks(root: string, out: (line: string) => void): void {
  try {
    const result = installHooks(root);
    if (result.changed) {
      out(result.message);
    }
  } catch {
    // The hook is a convenience here; the command still runs.
  }
}
