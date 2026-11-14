import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { CatchUpPackage } from "#shared/core/catch-up.ts";

import { unpackTgz } from "./tgz.ts";

// 01.1's catch-up ships packed, so a guest's agent doesn't read it (and copy
// its names) before the attempt: three of four cold runs did when it was a
// plain folder. `pnpm ex 01.1 catch-up` unpacks it into a git-ignored folder
// under .pi/ and switches on the settings entry that points there. Its source
// lives on the reference branch; `catch-up.md` next to the archive says what
// it is in plain words.

export const catchUpArchive = (repoRoot: string) =>
  join(repoRoot, "shared", "first-package", "catch-up.tgz");

/** Where it lands: ignored by git, and not a folder Pi scans on its own. */
export const catchUpDir = (repoRoot: string) =>
  join(repoRoot, ".pi", "catch-up", "01.1");

/**
 * A first package someone already started, for `catch-up`: declared in
 * `.pi/settings.json` (relative to `.pi/`), off until then.
 */
export const startedPackage: CatchUpPackage = {
  piece:
    "a first package someone already started (one tool, one skill; rename everything)",
  source: "catch-up/01.1",
  url: ".pi/catch-up/01.1/README.md",
};

/**
 * Unpacks `archive` into `dest` unless `dest` already exists, so a second
 * catch-up never overwrites edits. Writes to a temp folder first, then renames.
 */
export async function unpackCatchUp(
  archive: string,
  dest: string
): Promise<"unpacked" | "present"> {
  if (existsSync(dest)) {
    return "present";
  }
  const files = unpackTgz(await readFile(archive));
  const temp = `${dest}.tmp-${randomBytes(4).toString("hex")}`;
  try {
    for (const file of files) {
      const to = join(temp, file.path);
      await mkdir(dirname(to), { recursive: true });
      await writeFile(to, file.content);
    }
    await mkdir(dirname(dest), { recursive: true });
    await rename(temp, dest);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  return "unpacked";
}
