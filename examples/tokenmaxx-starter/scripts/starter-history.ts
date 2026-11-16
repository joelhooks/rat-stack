import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { findRepoRoot } from "#shared/core/context.ts";
import { gitEnv } from "#shared/core/git-env.ts";

import {
  fenceProbeName,
  fileHash,
  type History,
  historyFile,
} from "./lib/update.ts";

// pnpm starter:history adds every file's current contents, and every version
// in this checkout's git history, to starter-files.json, the list
// the update (scripts/update.ts) recognises the starter's own files by. It
// only ever adds, so a shallow clone can't drop versions guests already have.
//
// With --check (in `pnpm check`), it fails when a tracked file as it is now
// isn't in the list, so a stale list can't be committed. It checks only a git
// clone of the starter itself: a copy without git, or a guest's own repo made
// from one, has nothing to publish, and its edits are the guest's.

/** The starter's first commit: a repo whose history holds it is the starter. */
const starterFirstCommit = "e7c1350650fd1b447f17c7be83e5de45855285be";

const root = findRepoRoot();
const run = (args: readonly string[]) =>
  spawnSync("git", args, {
    cwd: root,
    env: gitEnv(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
const git = (args: readonly string[]) => {
  const result = run(args);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
};

const path = join(root, historyFile);
const before: History = existsSync(path)
  ? (JSON.parse(readFileSync(path, "utf8")) as History)
  : { files: {} };
const shipped = (file: string) =>
  basename(file) !== basename(historyFile) && basename(file) !== fenceProbeName;
/**
 * Tracked files a copy gets: what `git archive` exports, so not the files a
 * `.gitattributes` marks `export-ignore` (a branch's own notes and tools).
 */
function tracked(): string[] {
  const files = git(["ls-files", "-c", "-z"])
    .split("\0")
    .filter((file) => file !== "" && shipped(file))
    .filter((file) => existsSync(join(root, file)));
  const attrs = git([
    "check-attr",
    "-z",
    "export-ignore",
    "--",
    ...files,
  ]).split("\0");
  const ignored = new Set<string>();
  for (let i = 0; i + 2 < attrs.length; i += 3) {
    if (attrs[i + 2] === "set") {
      ignored.add(attrs[i] ?? "");
    }
  }
  return files.filter((file) => !ignored.has(file));
}

function isStarterClone(): boolean {
  const top = run(["rev-parse", "--show-toplevel"]);
  if (
    top.status !== 0 ||
    realpathSync(top.stdout.trim()) !== realpathSync(root)
  ) {
    return false;
  }
  const firsts = run(["rev-list", "--max-parents=0", "HEAD"]);
  return firsts.status === 0 && firsts.stdout.includes(starterFirstCommit);
}

if (process.argv.includes("--check")) {
  if (!isStarterClone()) {
    console.log(
      "Not a git clone of the starter itself: nothing to check here."
    );
    process.exit(0);
  }
  const unknown = tracked().filter(
    (file) => !(before.files[file] ?? []).includes(fileHash(join(root, file)))
  );
  if (unknown.length > 0) {
    console.error(
      `${historyFile} doesn't know these files as they are now, so the update would take them for a guest's edits:`
    );
    unknown.forEach((file) => console.error(`  ${file}`));
    console.error(
      "Run `pnpm starter:history`, then commit the list with them."
    );
    process.exit(1);
  }
  console.log(`${historyFile} knows every tracked file as it is now.`);
  process.exit(0);
}

const files = new Map<string, Set<string>>(
  Object.entries(before.files).map(([file, hashes]) => [file, new Set(hashes)])
);
const add = (file: string, hash: string) => {
  if (shipped(file)) {
    files.set(file, (files.get(file) ?? new Set()).add(hash));
  }
};

for (const commit of git(["rev-list", "HEAD"]).split("\n").filter(Boolean)) {
  for (const line of git(["ls-tree", "-r", "-z", commit]).split("\0")) {
    const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      add(match[2], match[1].slice(0, 16));
    }
  }
}
for (const file of tracked()) {
  add(file, fileHash(join(root, file)));
}

const sorted = Object.fromEntries(
  [...files.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([file, hashes]) => [file, [...hashes].toSorted()])
);
writeFileSync(path, `${JSON.stringify({ files: sorted }, null, 2)}\n`);
execFileSync(join(root, "node_modules", ".bin", "oxfmt"), [path], {
  cwd: root,
  stdio: "ignore",
});
const count = [...files.values()].reduce((n, set) => n + set.size, 0);
console.log(`${historyFile}: ${files.size} files, ${count} versions.`);
