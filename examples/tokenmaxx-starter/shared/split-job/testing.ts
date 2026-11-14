import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { commitLine } from "#shared/core/commit-line.ts";
import { exerciseContext, findRepoRoot } from "#shared/core/context.ts";

import { splitExercise } from "./exercise.ts";
import { gitEnv } from "./git.ts";
import { workerPath } from "./job.ts";

// Test helpers for 06.1: a throwaway guest repo, git in it, the worker
// command, and the exercise's commands pointed at that repo.

export const scratchDir = (prefix: string) =>
  realpathSync(mkdtempSync(join(tmpdir(), prefix)));

/** Runs git, throwing on failure. Commits as a fixed test identity. */
export function git(cwd: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=split test",
      "-c",
      "user.email=split-test@localhost",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    { cwd, env: gitEnv(), encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  }
  return result.stdout;
}

export function writeIn(root: string, path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A guest repo with one commit, under `scratch`. */
export function makeGuest(scratch: string, name = "guest"): string {
  const root = join(scratch, name);
  mkdirSync(root);
  git(root, "init", "-q");
  writeIn(root, "README.md", "guest\n");
  writeIn(root, "src/main.ts", "export const main = (): number => 1;\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "start");
  return realpathSync(root);
}

/** The supplied worker command, run in `cwd`. */
export function runWorker(cwd: string, stateDir: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [workerPath, ...args], {
    cwd,
    env: { ...process.env, TMX_STATE_DIR: stateDir },
    encoding: "utf8",
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** The exercise's commands for the guest at `guestRoot`, printing into `lines`. */
export function exerciseFor(guestRoot: string, stateDir: string) {
  const lines: string[] = [];
  const exercise = splitExercise(
    { id: "06.1", title: "t" },
    {
      out: (line) => lines.push(line),
      err: (line) => lines.push(line),
      now: () => new Date(),
      commit: (ctx) =>
        commitLine(ctx, {
          env: { ...process.env, TMX_GUEST_ROOT: guestRoot },
        }),
    }
  );
  const ctx = exerciseContext({
    exerciseId: "06.1",
    repoRoot: findRepoRoot(),
    guestRoot,
    env: { TMX_STATE_DIR: stateDir },
  });
  const run = async (command: string, ...args: string[]) => {
    lines.length = 0;
    const fn = exercise.commands[command];
    if (fn === undefined) {
      throw new Error(`no command ${command}`);
    }
    const code = await fn(ctx, args);
    return { code, lines: [...lines] };
  };
  return { run, ctx };
}
