import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { afterAll, describe, expect, it } from "vitest";

import { exerciseContext, findRepoRoot } from "#shared/core/context.ts";
import { readDeclared } from "#shared/core/pi-settings.ts";

import {
  catchUpArchive,
  catchUpDir,
  startedPackage,
  unpackCatchUp,
} from "./catch-up.ts";
import { firstPackageExercise } from "./exercise.ts";
import { packTgz, unpackTgz } from "./tgz.ts";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "tmx-catch-up-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const repoRoot = findRepoRoot();
const off = { extensions: [], skills: [], prompts: [], themes: [] };

describe("the catch-up archive", () => {
  it("round-trips files, byte for byte, and packs the same bytes twice", () => {
    const files = [
      { path: "b/two.txt", content: Buffer.from("two\n") },
      { path: "a.md", content: Buffer.alloc(1300, 120) },
    ];
    expect(packTgz(files).equals(packTgz([...files].toReversed()))).toBe(true);
    expect(unpackTgz(packTgz(files))).toEqual([files[1], files[0]]);
  });

  it("is readable by the system tar too", () => {
    const listed = execFileSync("tar", ["-tzf", catchUpArchive(repoRoot)], {
      encoding: "utf8",
    });
    expect(listed.split("\n").filter(Boolean).toSorted()).toEqual([
      "README.md",
      "extensions/wombat-gauge.ts",
      "skills/wombat-ritual/SKILL.md",
    ]);
  });

  it("refuses paths that would land outside the folder", () => {
    expect(() => packTgz([{ path: "../x", content: Buffer.from("") }])).toThrow(
      /unsafe path/
    );
    // A hand-made archive with an absolute path.
    const tar = Buffer.alloc(1536);
    tar.write("/etc/x", 0);
    tar.write("0", 156);
    expect(() => unpackTgz(gzipSync(tar))).toThrow(/unsafe path/);
  });
});

describe("unpacking it", () => {
  it("unpacks once and never overwrites edits", async () => {
    const dest = join(scratch, "once", "01.1");
    expect(await unpackCatchUp(catchUpArchive(repoRoot), dest)).toBe(
      "unpacked"
    );
    expect(existsSync(join(dest, "skills", "wombat-ritual", "SKILL.md"))).toBe(
      true
    );
    writeFileSync(join(dest, "README.md"), "mine\n");
    expect(await unpackCatchUp(catchUpArchive(repoRoot), dest)).toBe("present");
    expect(readFileSync(join(dest, "README.md"), "utf8")).toBe("mine\n");
  });

  it("`catch-up` unpacks under .pi/ and switches the entry on", async () => {
    // A repo shaped like the starter: the archive, and the entry shipped off.
    const repo = join(scratch, "repo");
    mkdirSync(join(repo, ".pi"), { recursive: true });
    mkdirSync(join(repo, "shared", "first-package"), { recursive: true });
    writeFileSync(catchUpArchive(repo), readFileSync(catchUpArchive(repoRoot)));
    writeFileSync(
      join(repo, ".pi", "settings.json"),
      JSON.stringify({
        packages: [{ source: startedPackage.source, ...off }],
      })
    );
    const lines: string[] = [];
    const exercise = firstPackageExercise(
      { id: "01.1", title: "t" },
      {
        fence: () => Promise.reject(new Error("unused")),
        probe: () => Promise.reject(new Error("unused")),
        out: (l) => lines.push(l),
      }
    );
    const ctx = exerciseContext({
      exerciseId: "01.1",
      repoRoot: repo,
      env: { TMX_STATE_DIR: join(scratch, "state") },
    });
    const command = exercise.commands["catch-up"];
    expect(await command?.(ctx, [])).toBe(0);
    expect(
      existsSync(join(catchUpDir(repo), "extensions", "wombat-gauge.ts"))
    ).toBe(true);
    expect(readDeclared(repo, startedPackage.source).switchedOn).toBe(true);
    expect(lines.join("\n")).toContain(".pi/catch-up/01.1");
  });
});
