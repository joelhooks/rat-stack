import { execFileSync } from "node:child_process";
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

import { afterAll, describe, expect, it } from "vitest";

import {
  commitClaim,
  type CommitContext,
  hookRunEnv,
  markStepStart,
  stepStartPath,
} from "./commit-line.ts";
import { gitEnv } from "./git-env.ts";

// The commit line, as stories in both shapes: the starter as the guest's
// repo, and the starter as `workshop/` inside it. Each guest repo is real,
// and so is its hook.

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "tmx-commit-line-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const env: NodeJS.ProcessEnv = {
  ...gitEnv(),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
const git = (cwd: string, args: string[], extra: NodeJS.ProcessEnv = {}) =>
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
    { cwd, env: { ...env, ...extra }, encoding: "utf8", stdio: "pipe" }
  ).trim();

const hourAgo = () => new Date(Date.now() - 3_600_000);
const twoHoursAgo = new Date(Date.now() - 7_200_000).toISOString();

// A fence in the spirit of the floor: refuses any tracked .ts file holding
// `BROKEN`, and logs every run so a test can count them.
const preCommit = (log: string) => `#!/bin/sh
echo run >> "${log}"
if git grep -q BROKEN -- '*.ts'; then echo "type error in src" >&2; exit 1; fi
`;

type Shape = "root" | "nested";

/**
 * A guest repo with one commit two hours old. `root`: the starter is the
 * repo. `nested`: the starter is its `workshop/` folder, untracked.
 */
function guest(name: string, shape: Shape, opts: { hook?: boolean } = {}) {
  const top = join(scratch, `${name}-${shape}`);
  const starter = shape === "root" ? top : join(top, "workshop");
  mkdirSync(join(starter, ".workshop-state", "02.1"), { recursive: true });
  mkdirSync(join(top, "src"), { recursive: true });
  git(scratch, ["init", "-q", "-b", "main", top]);
  writeFileSync(join(top, ".gitignore"), "node_modules/\n");
  writeFileSync(join(top, "src", "a.ts"), "export const a = 1;\n");
  const log = join(scratch, `${name}-${shape}.hook.log`);
  if (opts.hook === true) {
    mkdirSync(join(top, ".githooks"));
    writeFileSync(join(top, ".githooks", "pre-commit"), preCommit(log));
    chmodSync(join(top, ".githooks", "pre-commit"), 0o755);
    git(top, ["config", "core.hooksPath", ".githooks"]);
  }
  git(top, ["add", ".gitignore", "src", ...(opts.hook ? [".githooks"] : [])]);
  git(top, ["commit", "-q", "-m", "floor"], {
    GIT_AUTHOR_DATE: twoHoursAgo,
    GIT_COMMITTER_DATE: twoHoursAgo,
  });
  const ctx: CommitContext = {
    exerciseId: "02.1",
    repoRoot: starter,
    guestRoot: top,
    stateDir: join(starter, ".workshop-state", "02.1"),
  };
  const hookRuns = () => {
    try {
      return readFileSync(log, "utf8").split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  };
  const work = (file: string, text: string) => {
    writeFileSync(join(top, file), text);
    git(top, ["add", file]);
  };
  return { top, starter, ctx, hookRuns, work };
}

const claim = async (ctx: CommitContext, extra: NodeJS.ProcessEnv = {}) =>
  commitClaim(ctx, { env: { ...env, ...extra } });

describe.each<Shape>(["root", "nested"])(
  "the commit line, starter as %s",
  (shape) => {
    it("asks for setup first", async () => {
      const { ctx } = guest("nosetup", shape);
      const c = await claim(ctx);
      expect(c.ok).toBe(false);
      expect(c.detail).toBe(
        "Run pnpm ex 02.1 setup first: this step starts there."
      );
    });

    it("passes a last commit from before setup with a note, and one after without it", async () => {
      const { top, ctx, work } = guest("after", shape);
      const at = hourAgo();
      await markStepStart(ctx, at);
      const before = await claim(ctx);
      expect(before.ok).toBe(true);
      expect(before.detail).toBe(
        `${before.detail.slice(0, 7)} "floor" is committed, with nothing left over. git runs no commit hook in this repo, so there was none to go through. Note: your last commit is from before this step's setup (${at.toISOString()}); if this step added work, it's in it.`
      );
      work("src/b.ts", "export const b = 2;\n");
      git(top, ["commit", "-q", "-m", "wait for the job"]);
      const after = await claim(ctx);
      expect(after).toMatchObject({ ok: true });
      expect(after.detail).toMatch(
        /"wait for the job" is committed after this step's setup, with nothing left over\. git runs no commit hook/
      );
      expect(after.detail).not.toContain("Note:");
    });

    // Deadyawn's 02.2 trap: the work for two steps built and committed in one
    // go, then the second step's setup, then its done.
    it("passes work committed through the hook before the step's setup, with the note", async () => {
      const { top, ctx, work, hookRuns } = guest("early", shape, {
        hook: true,
      });
      work("src/wait.ts", "export const wait = 2;\n");
      git(top, ["commit", "-q", "-m", "the wait, for 02.1 and 02.2"]);
      const runs = hookRuns();
      // setup runs at least a second after the commit.
      await markStepStart(ctx, new Date(Date.now() + 2_000));
      const c = await claim(ctx);
      expect(c.ok).toBe(true);
      expect(c.detail).toMatch(
        /"the wait, for 02\.1 and 02\.2" is committed, with nothing left over, and your pre-commit hook passes it \(\d+\.\ds\)\. Note: your last commit is from before this step's setup \(.+\); if this step added work, it's in it\.$/
      );
      expect(hookRuns()).toBe(runs + 1);
    });

    it("still fails a commit from before setup when work is left over or the hook refuses it", async () => {
      const { top, ctx, work } = guest("early-fail", shape, { hook: true });
      work("src/c.ts", "export const c: string = BROKEN;\n");
      git(top, ["commit", "-q", "-n", "-m", "skipped the hook"]);
      await markStepStart(ctx, new Date(Date.now() + 2_000));
      const refused = await claim(ctx);
      expect(refused.ok).toBe(false);
      expect(refused.detail).toMatch(
        /"skipped the hook" is committed, but your pre-commit hook refuses it/
      );
      writeFileSync(join(top, "src", "a.ts"), "export const a = 3;\n");
      const dirty = await claim(ctx);
      expect(dirty.ok).toBe(false);
      expect(dirty.detail).toBe("Not committed yet: src/a.ts.");
    });

    it("fails on uncommitted work in the guest's repo, not in the starter's state", async () => {
      const { top, starter, ctx, work } = guest("dirty", shape);
      await markStepStart(ctx, hourAgo());
      work("src/b.ts", "export const b = 2;\n");
      git(top, ["commit", "-q", "-m", "b"]);
      writeFileSync(join(starter, ".workshop-state", "02.1", "x.json"), "{}");
      expect((await claim(ctx)).ok).toBe(true);
      writeFileSync(join(top, "src", "a.ts"), "export const a = 3;\n");
      writeFileSync(join(top, "src", "new.ts"), "export const n = 1;\n");
      const c = await claim(ctx);
      expect(c.ok).toBe(false);
      expect(c.detail).toBe("Not committed yet: src/a.ts, src/new.ts.");
    });

    it("passes a commit through the hook, and fails one made with -n over a tree the hook refuses", async () => {
      const { top, ctx, work, hookRuns } = guest("hooked", shape, {
        hook: true,
      });
      await markStepStart(ctx, hourAgo());
      work("src/b.ts", "export const b = 2;\n");
      git(top, ["commit", "-q", "-m", "through the hook"]);
      const runsBefore = hookRuns();
      const pass = await claim(ctx);
      expect(pass.ok).toBe(true);
      expect(pass.detail).toMatch(
        /and your pre-commit hook passes it \(\d+\.\ds\)\.$/
      );
      expect(hookRuns()).toBe(runsBefore + 1);
      // A second done remembers the pass for this HEAD.
      expect((await claim(ctx)).detail).toMatch(
        /your commit hook passed it \(checked /
      );
      expect(hookRuns()).toBe(runsBefore + 1);

      work("src/c.ts", "export const c: string = BROKEN;\n");
      expect(() => git(top, ["commit", "-q", "-m", "refused"])).toThrow(
        /type error in src/
      );
      git(top, ["commit", "-q", "-n", "-m", "skipped the hook"]);
      const c = await claim(ctx);
      expect(c.ok).toBe(false);
      expect(c.detail).toMatch(
        /"skipped the hook" is committed, but your pre-commit hook refuses it as it stands.*The hook said: type error in src$/
      );
    });

    it("doesn't run the hook again from inside a hook run", async () => {
      const { top, ctx, work, hookRuns } = guest("inside", shape, {
        hook: true,
      });
      await markStepStart(ctx, hourAgo());
      work("src/b.ts", "export const b = 2;\n");
      git(top, ["commit", "-q", "-m", "b"]);
      const runs = hookRuns();
      const c = await claim(ctx, { [hookRunEnv]: "1" });
      expect(c.ok).toBe(true);
      expect(hookRuns()).toBe(runs);
    });

    it("reads the guest's repo even with a hook's GIT_DIR and GIT_INDEX_FILE leaked in", async () => {
      const { top, ctx, work } = guest("leak", shape);
      const other = guest("leak-other", shape);
      await markStepStart(ctx, hourAgo());
      work("src/b.ts", "export const b = 2;\n");
      git(top, ["commit", "-q", "-m", "b"]);
      const c = await claim(ctx, {
        GIT_DIR: join(other.top, ".git"),
        GIT_INDEX_FILE: join(other.top, ".git", "index"),
      });
      expect(c).toMatchObject({ ok: true });
      expect(c.detail).toMatch(/"b" is committed/);
    });
  }
);

describe("the commit line", () => {
  it("ignores the starter's own folder when it sits inside the guest's repo", async () => {
    const { top, starter, ctx, work } = guest("starter-untracked", "nested");
    await markStepStart(ctx, hourAgo());
    work("src/b.ts", "export const b = 2;\n");
    git(top, ["commit", "-q", "-m", "b"]);
    writeFileSync(join(starter, "package.json"), "{}\n");
    expect((await claim(ctx)).ok).toBe(true);
  });

  // The floor one cold run built: pre-commit stamps the tree it checked, and
  // prepare-commit-msg, which -n doesn't skip, refuses a tree with no stamp.
  it("runs a stamp backstop after the pre-commit that stamps", async () => {
    const { top, ctx, work } = guest("stamp", "root", { hook: true });
    const hooks = join(top, ".githooks");
    const stamp = '"$(git rev-parse --git-path tmx-stamp)-$(git write-tree)"';
    writeFileSync(
      join(hooks, "pre-commit"),
      `${preCommit(join(scratch, "stamp.log"))}touch ${stamp}\n`
    );
    writeFileSync(
      join(hooks, "prepare-commit-msg"),
      `#!/bin/sh\n[ -f ${stamp} ] || { echo "the pre-commit gate did not run for this tree" >&2; exit 1; }\n`
    );
    chmodSync(join(hooks, "prepare-commit-msg"), 0o755);
    git(top, ["add", ".githooks"]);
    git(top, ["commit", "-q", "-m", "backstop"]);
    await markStepStart(ctx, hourAgo());
    work("src/b.ts", "export const b = 2;\n");
    git(top, ["commit", "-q", "-m", "b"]);
    const c = await claim(ctx);
    expect(c.detail).toMatch(
      /your pre-commit and prepare-commit-msg hooks pass it/
    );
    expect(c.ok).toBe(true);
  });

  it("keeps the first setup's time when setup runs again", async () => {
    const { ctx } = guest("resetup", "root");
    const first = hourAgo();
    await markStepStart(ctx, first);
    await markStepStart(ctx, new Date());
    expect(JSON.parse(readFileSync(stepStartPath(ctx), "utf8"))).toEqual({
      at: first.toISOString(),
    });
  });

  it("says so when the guest's folder isn't a repository", async () => {
    const dir = join(scratch, "no-repo");
    mkdirSync(dir);
    const ctx: CommitContext = {
      exerciseId: "02.1",
      repoRoot: dir,
      guestRoot: dir,
      stateDir: join(dir, "state"),
    };
    await markStepStart(ctx);
    const c = await claim(ctx, { GIT_CEILING_DIRECTORIES: scratch });
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/has no commit yet: is it a git repository\?/);
  });
});
