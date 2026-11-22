import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { cleanFolder } from "./exercise.ts";
import { blobId } from "./git.ts";
import { brokenLine, parts, readJob, readStamps } from "./job.ts";
import {
  exerciseFor,
  git,
  makeGuest,
  runWorker,
  scratchDir,
  writeIn,
} from "./testing.ts";

const scratch = scratchDir("tmx-split-");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("cleanFolder", () => {
  it("keeps folders inside the repo, as a/b", () => {
    expect(cleanFolder("split-job")).toBe("split-job");
    expect(cleanFolder("packages/x/src/")).toBe("packages/x/src");
    expect(cleanFolder("./a//b")).toBe("a/b");
  });

  it("refuses the root, a way out, an absolute path and .git", () => {
    for (const bad of [
      "",
      ".",
      "..",
      "../x",
      "a/../../x",
      "/tmp/x",
      ".git/x",
    ]) {
      expect(cleanFolder(bad)).toBeNull();
    }
  });
});

describe("blobId", () => {
  it("matches git hash-object", () => {
    const dir = makeGuest(scratch, "hash");
    writeIn(dir, "x.ts", "export const x = 1;\n");
    expect(git(dir, "hash-object", "x.ts").trim()).toBe(
      blobId("export const x = 1;\n")
    );
  });
});

describe("06.1 setup and the worker", () => {
  it("writes part c with the guest's semicolon style and a type error", async () => {
    const guest = makeGuest(scratch, "nosemi");
    writeIn(guest, "src/main.ts", "export const main = (): number => 1\n");
    git(guest, "commit", "-q", "-am", "no semicolons");
    const state = join(scratch, "nosemi-state");
    const { run } = exerciseFor(guest, state);
    const setup = await run("setup", "lib/jobs");
    expect(setup.code).toBe(0);
    const job = await readJob(state);
    expect(job?.dir).toBe("lib/jobs");
    expect(job?.semicolons).toBe(false);
    expect(setup.lines.join("\n")).toMatch(/Part c: create lib\/jobs\/half.ts/);

    const copy = join(scratch, "nosemi-copy");
    git(guest, "worktree", "add", "-q", "--detach", copy);
    const result = runWorker(copy, state, "c");
    expect({ code: result.code, stderr: result.stderr }).toEqual({
      code: 0,
      stderr: "",
    });
    expect(result.stdout).toMatch(/^done$/m);
    const text = readFileSync(join(copy, "lib/jobs/half.ts"), "utf8");
    expect(text).toContain(`${brokenLine}\n`);
    expect(text).toContain(job?.jobId ?? "missing");
    const stamps = await readStamps(state, job?.jobId ?? "");
    expect(stamps.map((s) => [s.part, s.scripted, s.reported])).toEqual([
      ["c", true, "done"],
    ]);
  });

  it("warns when the job's files are already in the repo", async () => {
    const guest = makeGuest(scratch, "already");
    writeIn(guest, "split-job/double.ts", "old\n");
    const { run } = exerciseFor(guest, join(scratch, "already-state"));
    const setup = await run("setup");
    expect(setup.lines.join("\n")).toMatch(
      /Already in your repo from before: split-job\/double.ts/
    );
  });

  it("refuses a folder outside the repo", async () => {
    const guest = makeGuest(scratch, "outside");
    const { run } = exerciseFor(guest, join(scratch, "outside-state"));
    expect((await run("setup", "../elsewhere")).code).toBe(2);
  });

  it("says what to do with no job, a bad part, or no copy", async () => {
    const guest = makeGuest(scratch, "usage");
    const state = join(scratch, "usage-state");
    expect(runWorker(guest, state, "a").stderr).toMatch(/No split job/);
    const { run } = exerciseFor(guest, state);
    const none = await run("done");
    expect(none.code).toBe(1);
    expect(none.lines.at(-1)).toBe(
      "Not started. Start it with: pnpm ex 06.1 setup"
    );
    await run("setup");
    expect(runWorker(guest, state, "z").code).toBe(2);
    expect(runWorker(guest, state).stderr).toMatch(/Parts: a, b, c/);
  });

  it("shows each stamp and whether its copy is still there", async () => {
    const guest = makeGuest(scratch, "status");
    const state = join(scratch, "status-state");
    const { run } = exerciseFor(guest, state);
    await run("setup");
    const copy = join(scratch, "status-copy");
    git(guest, "worktree", "add", "-q", "--detach", copy);
    runWorker(copy, state, "a");
    let status = (await run("status")).lines.join("\n");
    expect(status).toMatch(/part a {2}scripted worker reported done/);
    expect(status).toMatch(/still there\): split-job\/double.ts/);
    git(guest, "worktree", "remove", "--force", copy);
    status = (await run("status")).lines.join("\n");
    expect(status).toMatch(/\(closed\)/);
  });

  it("gives each honest part code that typechecks as one line", () => {
    const job = {
      jobId: "job_x",
      guestRoot: "/g",
      dir: "d",
      setupHead: null,
      semicolons: true,
      at: "",
    };
    expect(parts.a.content(job)).toBe(
      "export const double = (value: number): number => value * 2;\n"
    );
    expect(parts.b.content({ ...job, semicolons: false })).toBe(
      "export const square = (value: number): number => value * value\n"
    );
  });
});
