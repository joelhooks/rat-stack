import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { Job } from "#shared/split-job/job.ts";
import { judge } from "#shared/split-job/judge.ts";
import type { Facts, SeenStamp } from "#shared/split-job/observe.ts";
import {
  exerciseFor,
  git,
  makeGuest,
  runWorker,
  scratchDir,
} from "#shared/split-job/testing.ts";

// The done check's rules, as stories: given the workers' stamps and the
// guest's repo, which claims pass. None of them knows or cares how the
// guest's boss splits, copies, judges or keeps work.

const job: Job = {
  jobId: "job_test",
  guestRoot: "/guest",
  dir: "split-job",
  setupHead: "base",
  semicolons: true,
  at: "2026-11-17T16:00:00.000Z",
};
const A = "a".repeat(40);
const B = "b".repeat(40);
const LIAR = "c".repeat(40);
const OTHER = "d".repeat(40);
const double = "split-job/double.ts";
const square = "split-job/square.ts";
const half = "split-job/half.ts";

const stamp = (
  part: "a" | "b" | "c",
  copyRoot: string,
  files: Record<string, string>,
  opts: { scripted?: boolean; open?: boolean } = {}
): SeenStamp => ({
  jobId: job.jobId,
  part,
  copyRoot,
  inGuest: copyRoot === "/guest",
  copyId: `${copyRoot}-id`,
  session: null,
  scripted: opts.scripted ?? false,
  reported: opts.scripted === true ? "done" : null,
  files,
  at: "2026-11-17T16:05:00.000Z",
  open: opts.open ?? false,
});

const honestA = stamp("a", "/copies/a", { [double]: A });
const honestB = stamp("b", "/copies/b", { [square]: B });
const liar = stamp("c", "/copies/c", { [half]: LIAR }, { scripted: true });

const passing: Facts = {
  job,
  stamps: [honestA, honestB, liar],
  base: {},
  tree: { [double]: A, [square]: B, [half]: null },
  index: { [double]: A, [square]: B },
  branch: "main",
  onBranch: [],
  kept: { [LIAR]: ["stash@{0}"] },
};

const verdict = (facts: Facts) => judge(facts).map((c) => c.ok);
const detail = (facts: Facts, i: number) => judge(facts)[i]?.detail ?? "";

describe("the 06.1 done check", () => {
  it("passes: three copies, own files only, a and b landed, c turned down and kept", () => {
    expect(verdict(passing)).toEqual([true, true, true, true, true]);
    expect(detail(passing, 4)).toMatch(/kept in stash@\{0\}/);
  });

  it("fails when a part has no stamp", () => {
    const facts = { ...passing, stamps: [honestA, liar] };
    expect(verdict(facts)).toEqual([false, true, false, true, true]);
    expect(detail(facts, 0)).toMatch(/No worker stamped part b/);
  });

  it("fails when a worker works in the guest's repo itself", () => {
    const facts = {
      ...passing,
      stamps: [honestA, stamp("b", "/guest", { [square]: B }), liar],
    };
    expect(verdict(facts)[0]).toBe(false);
    expect(detail(facts, 0)).toMatch(/worked in your repo itself/);
  });

  it("fails when two parts share one copy", () => {
    const facts = {
      ...passing,
      stamps: [honestA, stamp("b", "/copies/a", { [square]: B }), liar],
    };
    expect(verdict(facts)[0]).toBe(false);
    expect(detail(facts, 0)).toMatch(
      /Parts a and b were done in the same copy/
    );
  });

  it("fails when a worker changes another part's file", () => {
    const facts = {
      ...passing,
      stamps: [
        stamp("a", "/copies/a", { [double]: A, [square]: OTHER }),
        honestB,
        liar,
      ],
    };
    expect(verdict(facts)).toEqual([true, false, true, true, true]);
    expect(detail(facts, 1)).toMatch(
      /Part a's worker changed split-job\/square.ts, which part b owns/
    );
  });

  it("doesn't count another part's landed result carried into a later copy", () => {
    const facts = {
      ...passing,
      stamps: [
        honestA,
        stamp("b", "/copies/b", { [double]: A, [square]: B }),
        liar,
      ],
    };
    expect(verdict(facts)[1]).toBe(true);
  });

  it("doesn't count files that were there at setup", () => {
    const facts = {
      ...passing,
      base: { [square]: OTHER },
      stamps: [
        stamp("a", "/copies/a", { [double]: A, [square]: OTHER }),
        honestB,
        liar,
      ],
    };
    expect(verdict(facts)[1]).toBe(true);
  });

  it("fails when a or b never landed, or landed as something else", () => {
    const missing = { ...passing, tree: { ...passing.tree, [square]: null } };
    expect(verdict(missing)[2]).toBe(false);
    expect(detail(missing, 2)).toMatch(/square.ts isn't in your repo/);
    const changed = { ...passing, tree: { ...passing.tree, [double]: OTHER } };
    expect(verdict(changed)[2]).toBe(false);
    expect(detail(changed, 2)).toMatch(/isn't what part a's worker stamped/);
  });

  it("fails both c lines when no scripted worker did part c", () => {
    const facts = {
      ...passing,
      stamps: [honestA, honestB, stamp("c", "/copies/c", { [half]: OTHER })],
    };
    expect(verdict(facts)).toEqual([true, true, true, false, false]);
    expect(detail(facts, 3)).toMatch(/never done by the scripted worker/);
    // The keep line doesn't repeat the turn-down line's sentence or detail.
    expect(judge(facts)[4]?.says).toBe(
      "Part c has no worker yet, so there's no closing to check."
    );
    expect(detail(facts, 4)).toBe("");
  });

  it("fails when the liar's file reaches the working tree, the index or the branch", () => {
    const inTree = { ...passing, tree: { ...passing.tree, [half]: LIAR } };
    expect(verdict(inTree)[3]).toBe(false);
    expect(detail(inTree, 3)).toMatch(/reached your working tree/);
    expect(detail(inTree, 3)).toMatch(/doesn't check split-job\//);
    const staged = { ...passing, index: { [half]: LIAR } };
    expect(verdict(staged)[3]).toBe(false);
    expect(detail(staged, 3)).toMatch(/your index/);
    const committed = { ...passing, onBranch: [LIAR] };
    expect(verdict(committed)[3]).toBe(false);
    expect(detail(committed, 3)).toMatch(/a commit on main/);
  });

  it("passes the turn-down when part c was redone honestly and landed", () => {
    const facts = { ...passing, tree: { ...passing.tree, [half]: OTHER } };
    expect(verdict(facts)[3]).toBe(true);
  });

  it("fails the keep while the liar's copy is still open", () => {
    const facts = {
      ...passing,
      stamps: [
        honestA,
        honestB,
        stamp(
          "c",
          "/copies/c",
          { [half]: LIAR },
          { scripted: true, open: true }
        ),
      ],
    };
    expect(verdict(facts)[4]).toBe(false);
    expect(detail(facts, 4)).toMatch(/still at \/copies\/c/);
  });

  it("fails the keep when the liar's work is nowhere", () => {
    const facts = { ...passing, kept: { [LIAR]: [] } };
    expect(verdict(facts)[4]).toBe(false);
    expect(detail(facts, 4)).toMatch(/lost when its copy closed/);
  });
});

// The same rules against real repos: a guest repo, git worktrees as the
// copies, the supplied worker command, and a boss played by these tests.

const scratch = scratchDir("tmx-split-done-");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
async function story() {
  n += 1;
  const dir = join(scratch, `s${n}`);
  const guest = makeGuest(scratch, `guest${n}`);
  const state = join(dir, "state");
  const { run } = exerciseFor(guest, state);
  expect((await run("setup")).code).toBe(0);
  const copy = (part: string) => {
    const path = join(dir, "copies", part);
    git(guest, "worktree", "add", "-q", "-b", `split/${part}`, path);
    return path;
  };
  const work = (path: string, ...args: string[]) => {
    const result = runWorker(path, state, ...args);
    expect({ code: result.code, stderr: result.stderr }).toEqual({
      code: 0,
      stderr: "",
    });
    return result;
  };
  const commitIn = (path: string, part: string) => {
    git(path, "add", "-A");
    git(path, "commit", "-q", "-m", `part ${part}`);
  };
  return { guest, state, run, copy, work, commitIn };
}

const passes = (lines: readonly string[]) =>
  lines
    .filter((l) => /^(PASS|FAIL) {5}/.test(l))
    .map((l) => l.startsWith("PASS"));

describe("06.1 against a real repo", () => {
  it("passes when the boss keeps a and b, turns c down, stashes it and closes every copy", async () => {
    const s = await story();
    const [a, b, c] = [s.copy("a"), s.copy("b"), s.copy("c")];
    expect(s.work(a, "a").stdout).toMatch(/^done$/m);
    s.work(b, "b");
    expect(s.work(c, "c").stdout).toMatch(/^done$/m);
    s.commitIn(a, "a");
    s.commitIn(b, "b");
    git(s.guest, "merge", "-q", "--no-edit", "split/a", "split/b");
    git(c, "stash", "push", "-q", "-u", "-m", "part c turned down");
    for (const path of [a, b, c]) {
      git(s.guest, "worktree", "remove", path);
    }
    const done = await s.run("done", "--details");
    expect(passes(done.lines)).toEqual([true, true, true, true, true, true]);
    expect(done.code).toBe(0);
    expect(done.lines.join("\n")).toMatch(/kept in stash@\{0\}/);

    // As a guest first sees it: one line per check, the details behind a flag.
    const short = await s.run("done");
    expect(passes(short.lines)).toEqual([true, true, true, true, true, true]);
    expect(short.code).toBe(0);
    expect(short.lines.join("\n")).not.toMatch(/kept in stash@\{0\}/);
    // The verdict wraps at 80 columns.
    expect(short.lines.slice(-4)).toEqual([
      "Done: three workers in their own copies, the broken part turned down, its work",
      "kept, and the step committed.",
      "Next: nothing. That was the last exercise.",
      "More: pnpm ex 06.1 done --details",
    ]);
    // A line holding the repo's path is as long as the path: macOS temp
    // paths alone pass 80 columns.
    expect(
      short.lines
        .filter((l) => !l.includes("checking "))
        .every((l) => l.length <= 80)
    ).toBe(true);
  });

  it("fails when the boss takes every done at its word", async () => {
    const s = await story();
    const copies = ["a", "b", "c"].map((p) => [p, s.copy(p)] as const);
    for (const [part, path] of copies) {
      s.work(path, part);
      s.commitIn(path, part);
    }
    git(s.guest, "merge", "-q", "--no-edit", "split/a", "split/b", "split/c");
    for (const [, path] of copies) {
      git(s.guest, "worktree", "remove", path);
    }
    const done = await s.run("done", "--details");
    expect(passes(done.lines)).toEqual([true, true, true, false, true, true]);
    expect(done.code).toBe(1);
  });

  it("fails when the turned-down copy is thrown away, and finds a patch in .git", async () => {
    const s = await story();
    const [a, b, c] = [s.copy("a"), s.copy("b"), s.copy("c")];
    s.work(a, "a");
    s.work(b, "b");
    s.work(c, "c");
    s.commitIn(a, "a");
    s.commitIn(b, "b");
    git(s.guest, "merge", "-q", "--no-edit", "split/a", "split/b");
    git(c, "add", "-A");
    const patch = git(c, "diff", "--cached");
    for (const path of [a, b]) {
      git(s.guest, "worktree", "remove", path);
    }
    git(s.guest, "worktree", "remove", "--force", c);
    git(s.guest, "branch", "-q", "-D", "split/c");
    const lost = await s.run("done", "--details");
    expect(passes(lost.lines)).toEqual([true, true, true, true, false, true]);
    expect(lost.lines.join("\n")).toMatch(/lost when its copy closed/);

    writeFileSync(join(s.guest, ".git", "part-c.patch"), patch);
    const kept = await s.run("done", "--details");
    expect(passes(kept.lines)).toEqual([true, true, true, true, true, true]);
    expect(kept.lines.join("\n")).toMatch(/\.git\/part-c\.patch/);
  });

  it("passes with plain copies, no .git, in an ignored folder of the repo", async () => {
    const s = await story();
    writeFileSync(join(s.guest, ".gitignore"), ".copies/\n");
    git(s.guest, "add", ".gitignore");
    git(s.guest, "commit", "-q", "-m", "ignore copies");
    const copy = (part: string) => {
      const path = join(s.guest, ".copies", part);
      cpSync(join(s.guest, "src"), join(path, "src"), { recursive: true });
      return path;
    };
    const [a, b, c] = [copy("a"), copy("b"), copy("c")];
    s.work(a, "a");
    s.work(b, "b");
    s.work(c, "c");
    for (const [path, part] of [
      [a, "double.ts"],
      [b, "square.ts"],
    ] as const) {
      cpSync(join(path, "split-job", part), join(s.guest, "split-job", part));
    }
    const broken = readFileSync(join(c, "split-job", "half.ts"), "utf8");
    const added = broken
      .trimEnd()
      .split("\n")
      .map((l) => `+${l}`);
    writeFileSync(
      join(s.guest, "c.patch"),
      [
        "--- /dev/null",
        "+++ b/split-job/half.ts",
        "@@ -0,0 +1,2 @@",
        ...added,
        "",
      ].join("\n")
    );
    for (const path of [a, b, c]) {
      rmSync(path, { recursive: true });
    }
    const open = await s.run("done", "--details");
    expect(passes(open.lines).at(-1)).toBe(false);
    expect(open.lines.join("\n")).toMatch(/Not committed yet: .*c\.patch/);
    git(s.guest, "add", "-A");
    git(s.guest, "commit", "-q", "-m", "parts a and b, and c kept as a patch");
    const done = await s.run("done", "--details");
    expect(passes(done.lines)).toEqual([true, true, true, true, true, true]);
    expect(done.lines.join("\n")).toMatch(/\.copies\/a/);
  });

  it("fails while every worker shares the guest's own folder", async () => {
    const s = await story();
    for (const part of ["a", "b"]) {
      s.work(s.guest, "stamp", part);
    }
    const refused = runWorker(s.guest, s.state, "c");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/is your repo itself/);
    const done = await s.run("done", "--details");
    expect(passes(done.lines)[0]).toBe(false);
  });
});
