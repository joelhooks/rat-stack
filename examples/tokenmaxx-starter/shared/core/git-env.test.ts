import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { gitEnv, repoLocalGitVars } from "./git-env.ts";

// What a guest's pre-commit hook hands the tests it runs. A test that drives
// git in a temp repo of its own (init, commit, worktree add) must act on that
// repo, never on the guest's, however its git env arrived.

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "tmx-git-env-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const base: NodeJS.ProcessEnv = {
  ...gitEnv(),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
const id = ["-c", "user.name=t", "-c", "user.email=t@example.com"];

const git = (cwd: string, args: string[], env = base) =>
  execFileSync("git", [...id, ...args], { cwd, env, encoding: "utf8" }).trim();

/** A guest repo with one commit and a pre-commit hook, unless told otherwise. */
function guestRepo(name: string, hook?: string): string {
  const repo = join(scratch, name);
  const hooks = join(scratch, `${name}-hooks`);
  mkdirSync(hooks, { recursive: true });
  git(scratch, ["init", "-q", "-b", "main", repo]);
  git(repo, ["config", "core.hooksPath", hooks]);
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(repo, ["add", "a.txt"]);
  git(repo, ["commit", "-q", "-m", "one"]);
  if (hook !== undefined) {
    writeFileSync(join(hooks, "pre-commit"), hook);
    chmodSync(join(hooks, "pre-commit"), 0o755);
  }
  return repo;
}

/** Everything a stray git call could change in the guest's repo. */
function snapshot(repo: string): string {
  return [
    git(repo, ["for-each-ref", "--format=%(refname) %(objectname)"]),
    git(repo, ["status", "--porcelain=v1", "--untracked-files=all"]),
    git(repo, ["worktree", "list", "--porcelain"]),
    readFileSync(join(repo, ".git", "config"), "utf8"),
    readFileSync(join(repo, ".git", "index")).toString("base64"),
  ].join("\n--\n");
}

/** A test's own git work: a temp repo, a linked worktree, a commit in it. */
function driveOwnRepo(env: NodeJS.ProcessEnv): string {
  const own = mkdtempSync(join(scratch, "own-"));
  const r = join(own, "r");
  const wt = join(own, "wt");
  git(own, ["init", "-q", r], env);
  git(r, ["commit", "-q", "--allow-empty", "-m", "init"], env);
  git(r, ["worktree", "add", "-q", wt], env);
  writeFileSync(join(wt, "f"), "x\n");
  git(wt, ["add", "f"], env);
  git(wt, ["commit", "-q", "-m", "wt"], env);
  return git(wt, ["rev-list", "--count", "HEAD"], env);
}

describe("gitEnv", () => {
  it("drops the variables that point git at a repository, and keeps the rest", () => {
    const leaked = Object.fromEntries(repoLocalGitVars.map((k) => [k, "x"]));
    expect(
      gitEnv({ ...leaked, PATH: "/bin", GIT_CONFIG_GLOBAL: "/dev/null" })
    ).toEqual({ PATH: "/bin", GIT_CONFIG_GLOBAL: "/dev/null" });
  });

  // A later git may list more; these are the ones a hook hands down.
  it("drops the ones this git lists for a hook's repo", () => {
    const listed = git(scratch, ["rev-parse", "--local-env-vars"]).split("\n");
    for (const key of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"]) {
      expect(listed).toContain(key);
      expect(gitEnv({ [key]: "x" })).toEqual({});
    }
  });

  it("keeps a leaked GIT_DIR and GIT_INDEX_FILE off the guest's repo", () => {
    const guest = guestRepo("leaked");
    const before = snapshot(guest);
    const leaked = {
      ...base,
      GIT_DIR: join(guest, ".git"),
      GIT_INDEX_FILE: join(guest, ".git", "index"),
    };
    expect(driveOwnRepo(gitEnv(leaked))).toBe("2");
    expect(snapshot(guest)).toBe(before);
    // Without it, the same work lands in the guest's repo.
    try {
      driveOwnRepo(leaked);
    } catch {
      // It may fail part way; the harm is what it did before that.
    }
    expect(snapshot(guest)).not.toBe(before);
  });

  // The real thing: git's own hook env, from `commit -a` (an absolute index)
  // and from a linked worktree (GIT_DIR too).
  it("lets a test inside a real pre-commit hook drive its own repo", () => {
    const driver = join(scratch, "driver.mts");
    const gitEnvPath = fileURLToPath(new URL("./git-env.ts", import.meta.url));
    writeFileSync(
      driver,
      [
        `import { execFileSync } from "node:child_process";`,
        `import { mkdtempSync, writeFileSync } from "node:fs";`,
        `import { join } from "node:path";`,
        `import { gitEnv, repoLocalGitVars } from ${JSON.stringify(gitEnvPath)};`,
        `const leaked = repoLocalGitVars.filter((k) => process.env[k] !== undefined);`,
        `writeFileSync(process.env.TMX_LEAKED_OUT, leaked.join(","));`,
        `const env = gitEnv();`,
        `const git = (cwd, ...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { cwd, env, stdio: "pipe" });`,
        `const own = mkdtempSync(join(process.env.TMX_OWN_DIR, "own-"));`,
        `git(own, "init", "-q", "r");`,
        `git(join(own, "r"), "commit", "-q", "--allow-empty", "-m", "init");`,
        `git(join(own, "r"), "worktree", "add", "-q", join(own, "wt"));`,
        `writeFileSync(join(own, "wt", "f"), "x\\n");`,
        `git(join(own, "wt"), "add", "f");`,
        `git(join(own, "wt"), "commit", "-q", "-m", "wt");`,
      ].join("\n")
    );
    const guest = guestRepo(
      "hooked",
      `#!/bin/sh\nexec "${process.execPath}" "${driver}"\n`
    );
    const env = { ...base, TMX_OWN_DIR: scratch };
    const commit = (cwd: string, out: string, args: string[]) => {
      const result = spawnSync("git", [...id, "commit", "-q", ...args], {
        cwd,
        env: { ...env, TMX_LEAKED_OUT: out },
        encoding: "utf8",
      });
      return {
        code: result.status,
        leaked: readFileSync(out, "utf8").split(","),
      };
    };

    writeFileSync(join(guest, "a.txt"), "b\n");
    const all = commit(guest, join(scratch, "leaked-a"), ["-am", "two"]);
    expect(all.code).toBe(0);
    expect(all.leaked).toContain("GIT_INDEX_FILE");

    const linked = join(scratch, "hooked-wt");
    git(guest, ["worktree", "add", "-q", linked]);
    writeFileSync(join(linked, "a.txt"), "c\n");
    git(linked, ["add", "a.txt"]);
    const fromLinked = commit(linked, join(scratch, "leaked-wt"), ["-m", "3"]);
    expect(fromLinked.code).toBe(0);
    expect(fromLinked.leaked).toEqual(
      expect.arrayContaining(["GIT_DIR", "GIT_INDEX_FILE"])
    );
    expect(git(guest, ["rev-list", "--count", "main"])).toBe("2");
  });
});
