import { existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { blobId, gitOut, nulList } from "./git.ts";
import {
  brokenLine,
  copyOpen,
  type Job,
  ownedPath,
  partIds,
  type Stamp,
} from "./job.ts";

// What the 06.1 done check sees, read without changing anything: the
// workers' stamps, and the guest's repo (its working tree, index, branch,
// refs, stashes and patch files). `judge.ts` decides what it means.

export type SeenStamp = Stamp & {
  /** The copy is still there: same path, same folder. */
  readonly open: boolean;
};

export type Facts = {
  readonly job: Job;
  readonly stamps: readonly SeenStamp[];
  /** Files in the job's folder at setup, repo-relative, to blob IDs. */
  readonly base: Readonly<Record<string, string>>;
  /** Each part's file in the guest's working tree, or null when it's not there. */
  readonly tree: Readonly<Record<string, string | null>>;
  /** Files in the job's folder in the guest's index. */
  readonly index: Readonly<Record<string, string>>;
  /** HEAD's branch, or `HEAD` when detached. */
  readonly branch: string;
  /** Blobs among `wanted` that HEAD's commits since setup hold. */
  readonly onBranch: readonly string[];
  /** For each blob in `wanted`: the refs, stashes and patch files that hold it. */
  readonly kept: Readonly<Record<string, readonly string[]>>;
};

/** The scripted worker's part c results: the blobs that must never land. */
export const liarBlobs = (job: Job, stamps: readonly Stamp[]): string[] => [
  ...new Set(
    stamps
      .filter((s) => s.scripted && s.part === "c")
      .flatMap((s) => {
        const blob = s.files[ownedPath(job, "c")];
        return blob === undefined ? [] : [blob];
      })
  ),
];

const lines = (text: string | null) =>
  (text ?? "").split("\n").filter((l) => l !== "");

/** `<mode> <blob> <stage>\t<path>` or `<mode> <type> <blob>\t<path>`, NUL-separated. */
function blobsByPath(text: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of nulList(text)) {
    const tab = entry.indexOf("\t");
    const fields = entry.slice(0, tab).split(" ");
    const blob = fields.find((f) => /^[0-9a-f]{40,64}$/.test(f));
    if (tab > 0 && blob !== undefined) {
      out[entry.slice(tab + 1)] = blob;
    }
  }
  return out;
}

async function commitExists(root: string, rev: string | null) {
  return (
    rev !== null &&
    (await gitOut(root, ["cat-file", "-e", `${rev}^{commit}`])) !== null
  );
}

/** Which of `wanted` the commits `revs` reach, not counting what `since` reaches. */
async function reaches(
  root: string,
  revs: readonly string[],
  since: string | null,
  wanted: readonly string[]
): Promise<string[]> {
  if (revs.length === 0 || wanted.length === 0) {
    return [];
  }
  const out = await gitOut(root, [
    "rev-list",
    "--objects",
    ...revs,
    ...(since === null ? [] : ["--not", since]),
  ]);
  const seen = new Set(lines(out).map((l) => l.split(" ")[0]));
  return wanted.filter((blob) => seen.has(blob));
}

/** Every ref and every stash entry: a name to show, and the commit. */
async function keepers(root: string) {
  const refs = lines(
    await gitOut(root, [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)%00%(objecttype)",
    ])
  )
    .map((l) => l.split("\0"))
    // The stash list below names refs/stash's entries one by one.
    .filter(
      ([name, , type]) =>
        name !== "refs/stash" && (type === "commit" || type === "tag")
    )
    .map(([name = "", rev = ""]) => ({ name, rev }));
  const stashes = lines(
    await gitOut(root, ["stash", "list", "--format=%gd%x00%H"])
  )
    .map((l) => l.split("\0"))
    .map(([name = "", rev = ""]) => ({ name, rev }));
  return [...refs, ...stashes];
}

const isPatch = (path: string) => /\.(patch|diff)$/i.test(path);

/** `*.patch` and `*.diff` files in the guest's tree (ignored ones too) and its git dir. */
async function patchFiles(root: string): Promise<string[]> {
  const listed = [
    ...nulList(
      await gitOut(root, [
        "ls-files",
        "-z",
        "-c",
        "-o",
        "--",
        "*.patch",
        "*.diff",
      ])
    ),
    ...nulList(
      await gitOut(root, [
        "ls-files",
        "-z",
        "-o",
        "-i",
        "--exclude-standard",
        "--",
        "*.patch",
        "*.diff",
      ])
    ),
  ].map((path) => join(root, path));
  const gitDir = (
    await gitOut(root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ])
  )?.trim();
  const inGit: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (depth > 6) {
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && !["objects", "lfs"].includes(entry.name)) {
        await walk(path, depth + 1);
      } else if (entry.isFile() && isPatch(entry.name)) {
        inGit.push(path);
      }
    }
  };
  if (gitDir !== undefined && gitDir !== "") {
    await walk(gitDir, 0);
  }
  return [...new Set([...listed, ...inGit])];
}

/** Patch files that hold part c's broken file for this job. */
async function patchesHolding(root: string, job: Job): Promise<string[]> {
  const found: string[] = [];
  for (const path of await patchFiles(root)) {
    try {
      if (statSync(path).size > 5_000_000) {
        continue;
      }
      const text = await readFile(path, "utf8");
      if (text.includes(job.jobId) && text.includes(brokenLine)) {
        const rel = relative(root, path);
        found.push(rel.startsWith("..") ? path : rel.split(sep).join("/"));
      }
    } catch {
      // Unreadable: it can't be shown, so it doesn't count.
    }
  }
  return found;
}

async function readBlob(path: string): Promise<string | null> {
  try {
    return blobId(await readFile(path));
  } catch {
    return null;
  }
}

/** Everything the done check needs, from the guest root the job was set up in. */
export async function observe(
  job: Job,
  stamps: readonly Stamp[]
): Promise<Facts> {
  const root = resolve(job.guestRoot);
  const wanted = liarBlobs(job, stamps);
  const setup = (await commitExists(root, job.setupHead))
    ? job.setupHead
    : null;
  const head = await commitExists(root, "HEAD");

  const tree: Record<string, string | null> = {};
  for (const id of partIds) {
    const path = ownedPath(job, id);
    tree[path] = await readBlob(join(root, path));
  }
  const base =
    setup === null
      ? {}
      : blobsByPath(
          await gitOut(root, ["ls-tree", "-r", "-z", setup, "--", job.dir])
        );
  const index = blobsByPath(
    await gitOut(root, ["ls-files", "-s", "-z", "--", job.dir])
  );
  const branch =
    (await gitOut(root, ["symbolic-ref", "-q", "--short", "HEAD"]))?.trim() ||
    "HEAD";
  const onBranch = head ? await reaches(root, ["HEAD"], setup, wanted) : [];

  const kept: Record<string, string[]> = {};
  if (wanted.length > 0) {
    const all = await keepers(root);
    const anywhere = await reaches(
      root,
      all.map((k) => k.rev),
      setup,
      wanted
    );
    for (const blob of wanted) {
      kept[blob] = [];
    }
    for (const keeper of anywhere.length === 0 ? [] : all) {
      for (const blob of await reaches(root, [keeper.rev], setup, anywhere)) {
        kept[blob]?.push(keeper.name);
      }
    }
    const patches = await patchesHolding(root, job);
    for (const blob of wanted) {
      kept[blob]?.push(...patches);
    }
  }

  return {
    job,
    stamps: stamps.map((s) => ({ ...s, open: copyOpen(s) })),
    base,
    tree,
    index,
    branch,
    onBranch,
    kept,
  };
}

/** Whether the guest root the job was set up in is still there. */
export const guestRootThere = (job: Job) => existsSync(job.guestRoot);
