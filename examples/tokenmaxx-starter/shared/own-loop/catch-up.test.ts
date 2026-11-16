import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { catchUp } from "#shared/core/catch-up.ts";
import { exerciseContext, findRepoRoot } from "#shared/core/context.ts";
import {
  pinnedGitPackages,
  readDeclared,
  settingsPath,
} from "#shared/core/pi-settings.ts";

import { waitPackage } from "./exercise.ts";

// 02.1's catch-up: the pinned pi-until package, declared switched off in the
// starter's .pi/settings.json.

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "tmx-wait-catch-up-")));
afterAll(() => rmSync(scratch, { recursive: true }));

const sha = "bf7abfe46ce51fa59cf7318dc3bd6c0c248e3dd6";
const loop = "git:github.com/joelhooks/pi-until";
const pinned = `${loop}@${sha}`;
const off = { extensions: [], skills: [], prompts: [], themes: [] };

describe("02.1's catch-up package", () => {
  it("is declared in the repo's own settings", () => {
    expect(waitPackage.source).toBe(loop);
    expect(pinnedGitPackages(findRepoRoot())).toContainEqual({
      repo: "github.com/joelhooks/pi-until",
      commit: sha,
      source: pinned,
    });
  });

  it("switches on once and points at where to read it", async () => {
    const repo = join(scratch, "catch-up");
    mkdirSync(join(repo, ".pi"), { recursive: true });
    writeFileSync(
      settingsPath(repo),
      JSON.stringify({ packages: [{ source: pinned, ...off }] })
    );
    const ctx = exerciseContext({
      exerciseId: "02.1",
      repoRoot: repo,
      env: {},
    });
    const lines: string[] = [];
    const command = catchUp(waitPackage, { out: (line) => lines.push(line) });
    expect(await command(ctx, [])).toBe(0);
    expect(readDeclared(repo, loop).switchedOn).toBe(true);
    expect(lines.join("\n")).toContain(waitPackage.url);
    expect(lines.join("\n")).not.toMatch(/reveal/i);
    lines.length = 0;
    expect(await command(ctx, [])).toBe(0);
    expect(lines[0]).toMatch(/already switched on/);
  });
});
