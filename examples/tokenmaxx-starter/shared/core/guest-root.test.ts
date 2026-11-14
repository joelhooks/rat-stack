import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { exerciseContext } from "./context.ts";
import { gitEnv } from "./git-env.ts";
import { findGuestRoot, isNestedStarter } from "./guest-root.ts";

const made: string[] = [];
afterEach(async () => {
  await Promise.all(
    made.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tmx-guest-root-"));
  made.push(dir);
  return dir;
}

const gitInit = (dir: string) =>
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore", env: gitEnv() });

async function starterIn(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "tokenmaxx-starter" })
  );
  return dir;
}

describe("findGuestRoot", () => {
  it("is the starter itself when it is its own repo", async () => {
    const starter = await starterIn(await folder());
    gitInit(starter);
    expect(findGuestRoot(starter, {})).toBe(starter);
    expect(isNestedStarter(starter, {})).toBe(false);
  });

  it("is the starter itself when no git repo holds it", async () => {
    const starter = await starterIn(await folder());
    expect(findGuestRoot(starter, {})).toBe(starter);
  });

  it("is the guest's repo when the starter is a folder inside it", async () => {
    const guest = await folder();
    gitInit(guest);
    const starter = await starterIn(join(guest, "workshop"));
    expect(findGuestRoot(starter, {})).toBe(realpathSync(guest));
    expect(isNestedStarter(starter, {})).toBe(true);
  });

  it("ignores git's own environment, as a guest's hook would set it", async () => {
    const guest = await folder();
    gitInit(guest);
    const starter = await starterIn(join(guest, "workshop"));
    const elsewhere = await folder();
    gitInit(elsewhere);
    const env = {
      GIT_DIR: join(elsewhere, ".git"),
      GIT_WORK_TREE: elsewhere,
    };
    expect(findGuestRoot(starter, env)).toBe(realpathSync(guest));
  });

  it("goes into every exercise context", async () => {
    const guest = await folder();
    gitInit(guest);
    const starter = await starterIn(join(guest, "workshop"));
    const ctx = exerciseContext({
      exerciseId: "01.1",
      repoRoot: starter,
      env: {},
    });
    expect(ctx).toMatchObject({
      repoRoot: starter,
      guestRoot: realpathSync(guest),
      stateDir: join(starter, ".workshop-state", "01.1"),
    });
    expect(
      exerciseContext({
        exerciseId: "01.1",
        repoRoot: starter,
        guestRoot: "/g",
      }).guestRoot
    ).toBe("/g");
    // What `pnpm pi` exported wins over asking git again; an empty one doesn't.
    const fromEnv = (value: string) =>
      exerciseContext({
        exerciseId: "01.1",
        repoRoot: starter,
        env: { TMX_GUEST_ROOT: value },
      }).guestRoot;
    expect(fromEnv("/elsewhere")).toBe("/elsewhere");
    expect(fromEnv("")).toBe(realpathSync(guest));
  });
});
