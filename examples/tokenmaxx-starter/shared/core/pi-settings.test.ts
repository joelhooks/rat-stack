import {
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

import { startedPackage } from "#shared/first-package/catch-up.ts";
import { waitPackage } from "#shared/own-loop/exercise.ts";

import { type CatchUpPackage, catchUp } from "./catch-up.ts";
import { exerciseContext, findRepoRoot } from "./context.ts";
import {
  pinnedGitPackages,
  readDeclared,
  setSwitchedOn,
  settingsPath,
} from "./pi-settings.ts";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "tmx-pi-settings-")));
afterAll(() => rmSync(scratch, { recursive: true }));

const sha = "bf7abfe46ce51fa59cf7318dc3bd6c0c248e3dd6";
const loop = "git:github.com/joelhooks/pi-until";
const pinned = `${loop}@${sha}`;
const off = { extensions: [], skills: [], prompts: [], themes: [] };

function repoWith(name: string, settings: unknown): string {
  const repo = join(scratch, name);
  mkdirSync(join(repo, ".pi"), { recursive: true });
  writeFileSync(settingsPath(repo), JSON.stringify(settings));
  return repo;
}

const read = (repo: string): unknown =>
  JSON.parse(readFileSync(settingsPath(repo), "utf8"));

describe("the repo's own settings", () => {
  const repoRoot = findRepoRoot();

  // A guest adds their own packages here (`pi install -l` writes to this
  // file) and `catch-up` switches entries on, so these check only that the
  // starter's own entries are declared and pinned: never the whole list, and
  // never on or off. That they ship switched off is a reference-check step.
  it("pins pi-until at bf7abfe", () => {
    expect(readDeclared(repoRoot, loop)).toMatchObject({
      source: pinned,
      commit: sha,
    });
  });

  it("declares the package 01.1's catch-up switches on", () => {
    expect(readDeclared(repoRoot, startedPackage.source)).toMatchObject({
      source: startedPackage.source,
      commit: null,
    });
  });

  it("declares the package 02.1's catch-up switches on", () => {
    expect(waitPackage.source).toBe(loop);
    expect(pinnedGitPackages(repoRoot)).toContainEqual({
      repo: "github.com/joelhooks/pi-until",
      commit: sha,
      source: pinned,
    });
  });
});

describe("a declared package", () => {
  it("reads every type filtered to [] as off, anything less as on", () => {
    expect(
      readDeclared(
        repoWith("off", { packages: [{ source: pinned, ...off }] }),
        loop
      )
    ).toEqual({ source: pinned, commit: sha, switchedOn: false });
    expect(
      readDeclared(repoWith("on", { packages: [pinned] }), loop).switchedOn
    ).toBe(true);
    const partial = repoWith("partial", {
      packages: [{ source: pinned, extensions: [] }],
    });
    expect(readDeclared(partial, loop).switchedOn).toBe(true);
  });

  it("switches on to the plain source, keeping other keys and packages", async () => {
    const repo = repoWith("switch", {
      theme: "dark",
      packages: ["npm:other@1.0.0", { source: pinned, ...off }],
    });
    expect(await setSwitchedOn(repo, loop, true)).toBe(true);
    expect(read(repo)).toEqual({
      theme: "dark",
      packages: ["npm:other@1.0.0", pinned],
    });
    expect(await setSwitchedOn(repo, loop, true)).toBe(false);
    expect(await setSwitchedOn(repo, loop, false)).toBe(true);
    expect(read(repo)).toEqual({
      theme: "dark",
      packages: ["npm:other@1.0.0", { source: pinned, ...off }],
    });
  });

  it("keeps an entry's non-filter keys when switching", async () => {
    const repo = repoWith("keys", {
      packages: [{ source: pinned, autoload: false, ...off }],
    });
    await setSwitchedOn(repo, loop, true);
    expect(read(repo)).toEqual({
      packages: [{ source: pinned, autoload: false }],
    });
  });

  it("names a local package by its path relative to .pi/", async () => {
    const local = "../catch-up/started";
    const repo = repoWith("local", {
      packages: [
        { source: pinned, ...off },
        { source: local, ...off },
      ],
    });
    expect(readDeclared(repo, local)).toEqual({
      source: local,
      commit: null,
      switchedOn: false,
    });
    await setSwitchedOn(repo, local, true);
    expect(read(repo)).toEqual({
      packages: [{ source: pinned, ...off }, local],
    });
    expect(pinnedGitPackages(repo).map((p) => p.source)).toEqual([pinned]);
  });

  it("refuses settings that pin no commit, or lack the package", () => {
    const unpinned = repoWith("unpinned", { packages: [loop] });
    expect(() => readDeclared(unpinned, loop)).toThrow(/does not pin/);
    const none = repoWith("none", {});
    expect(() => readDeclared(none, "../catch-up/x")).toThrow(
      /does not declare/
    );
    expect(pinnedGitPackages(none)).toEqual([]);
  });
});

describe("catch-up", () => {
  const ctxFor = (repoRoot: string, exerciseId = "02.1") =>
    exerciseContext({ exerciseId, repoRoot, env: {} });

  it("switches a git package on once and points at where to read it", async () => {
    const repo = repoWith("catch-up", {
      packages: [{ source: pinned, ...off }],
    });
    const lines: string[] = [];
    const command = catchUp(waitPackage, { out: (line) => lines.push(line) });
    expect(await command(ctxFor(repo), [])).toBe(0);
    expect(readDeclared(repo, loop).switchedOn).toBe(true);
    expect(lines.join("\n")).toContain(waitPackage.url);
    expect(lines.join("\n")).not.toMatch(/reveal/i);
    lines.length = 0;
    expect(await command(ctxFor(repo), [])).toBe(0);
    expect(lines[0]).toMatch(/already switched on/);
  });

  it("switches a local package on when its folder is in the checkout", async () => {
    const pkg: CatchUpPackage = {
      piece: "a started package",
      source: "../catch-up/started",
      url: "catch-up/started",
    };
    const repo = repoWith("catch-up-local", {
      packages: [
        { source: pinned, ...off },
        { source: pkg.source, ...off },
      ],
    });
    const command = catchUp(pkg, { out: () => undefined });
    await expect(command(ctxFor(repo, "01.1"), [])).rejects.toThrow(
      /not in this checkout/
    );
    expect(readDeclared(repo, pkg.source).switchedOn).toBe(false);
    mkdirSync(join(repo, "catch-up", "started"), { recursive: true });
    expect(await command(ctxFor(repo, "01.1"), [])).toBe(0);
    expect(readDeclared(repo, pkg.source).switchedOn).toBe(true);
    expect(readDeclared(repo, loop).switchedOn).toBe(false);
  });
});
