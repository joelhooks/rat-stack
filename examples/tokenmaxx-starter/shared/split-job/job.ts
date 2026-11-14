import { randomBytes } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import { now } from "#shared/core/paths.ts";
import { tryReadJson, writeJsonAtomic } from "#shared/core/store.ts";

import { blobId, gitOut, nulList, topLevel } from "./git.ts";

// The job for 06.1, split three ways, and the stamps its workers leave.
//
// The job is three small files in one folder of the guest's repo. Parts a
// and b are honest work. Part c is a fixed file with a type error, so it
// can't pass the guest's floor. Each worker, in its own copy of the repo,
// ends by running `worker.ts stamp <part>`: the stamp records which copy it
// worked in and every file in the job's folder there, by git blob ID. The
// supplied scripted worker (`worker.ts <part>`) writes its part, stamps it,
// prints `done` and exits 0 without running anything else.
//
// Stamps live in the starter's state dir, so they outlast the copies. They
// are what the done check reads about the workers; everything else it reads
// from the guest's own repo.

/** The exercise this job belongs to; the worker command finds its state by it. */
export const splitExerciseId = "06.1";

export const PartId = Schema.Literals(["a", "b", "c"]);
export type PartId = typeof PartId.Type;
export const partIds: readonly PartId[] = ["a", "b", "c"];

export type Part = {
  readonly id: PartId;
  readonly file: string;
  /** What the part asks for, after "create <path>". */
  readonly ask: (job: Job) => string;
  /** What a worker that does exactly that writes. */
  readonly content: (job: Job) => string;
};

const line = (code: string, semicolons: boolean) =>
  `${code}${semicolons ? ";" : ""}\n`;

/** Part c's one line: a number returned as a string, TS2322. */
export const brokenLine =
  "export const half = (value: number): string => value / 2";
const markLine = (job: Job) => `// Split job ${job.jobId}, part c.`;

export const parts: Readonly<Record<PartId, Part>> = {
  a: {
    id: "a",
    file: "double.ts",
    ask: () =>
      "exporting `double(value: number): number`, which returns twice the value.",
    content: (job) =>
      line(
        "export const double = (value: number): number => value * 2",
        job.semicolons
      ),
  },
  b: {
    id: "b",
    file: "square.ts",
    ask: () =>
      "exporting `square(value: number): number`, which returns the value times itself.",
    content: (job) =>
      line(
        "export const square = (value: number): number => value * value",
        job.semicolons
      ),
  },
  c: {
    id: "c",
    file: "half.ts",
    ask: (job) =>
      `holding exactly these two lines:\n    ${markLine(job)}\n    ${line(brokenLine, job.semicolons).trim()}`,
    content: (job) => `${markLine(job)}\n${line(brokenLine, job.semicolons)}`,
  },
};

/** A part's file, relative to the repo root, with `/`. */
export const ownedPath = (job: Job, part: PartId) =>
  posix.join(job.dir, parts[part].file);

/** The part that owns a repo-relative path, if any. */
export const ownerOf = (job: Job, path: string): PartId | null =>
  partIds.find((id) => ownedPath(job, id) === path) ?? null;

export const Job = Schema.Struct({
  jobId: Schema.String,
  /** The guest's repo root when the job was set up. */
  guestRoot: Schema.String,
  /** The job's folder, relative to the guest root, with `/`. */
  dir: Schema.String,
  /** The guest's HEAD at setup, or null in a repo with no commit. */
  setupHead: Schema.NullOr(Schema.String),
  semicolons: Schema.Boolean,
  at: Schema.String,
});
export type Job = typeof Job.Type;

export const Stamp = Schema.Struct({
  jobId: Schema.String,
  part: PartId,
  /** The top of the copy the worker ran in, real path. */
  copyRoot: Schema.String,
  /** The "copy" was the guest's own tree: see `copyRootOf`. */
  inGuest: Schema.Boolean,
  /** The copy folder's inode and birth time: a new folder at the same path is another copy. */
  copyId: Schema.String,
  session: Schema.NullOr(Schema.String),
  /** True for the supplied scripted worker. */
  scripted: Schema.Boolean,
  /** What the worker reported, when the stamp knows: the scripted worker says "done". */
  reported: Schema.NullOr(Schema.String),
  /** Every file in the job's folder in the copy: repo-relative path to blob ID. */
  files: Schema.Record(Schema.String, Schema.String),
  at: Schema.String,
});
export type Stamp = typeof Stamp.Type;

export const jobPath = (stateDir: string) => join(stateDir, "job.json");
export const stampsDir = (stateDir: string) => join(stateDir, "stamps");

export async function readJob(stateDir: string): Promise<Job | null> {
  const read = await tryReadJson(jobPath(stateDir), Job);
  return read.ok ? read.value : null;
}

export const writeJob = (stateDir: string, job: Job) =>
  writeJsonAtomic(jobPath(stateDir), job);

export function newJobId(): string {
  return `job_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
}

/** Every readable stamp for this job, oldest first. */
export async function readStamps(
  stateDir: string,
  jobId: string
): Promise<Stamp[]> {
  let names: string[];
  try {
    names = await readdir(stampsDir(stateDir));
  } catch {
    return [];
  }
  const stamps: Stamp[] = [];
  for (const name of names.filter((n) => n.endsWith(".json")).toSorted()) {
    const read = await tryReadJson(join(stampsDir(stateDir), name), Stamp);
    if (read.ok && read.value.jobId === jobId) {
      stamps.push(read.value);
    }
  }
  return stamps.toSorted((x, y) => x.at.localeCompare(y.at));
}

/** `ino:birthtime` of a folder, or null when it's gone. */
export function copyIdentity(path: string): string | null {
  try {
    const stat = statSync(path);
    return `${stat.ino}:${Math.round(stat.birthtimeMs)}`;
  } catch {
    return null;
  }
}

/** Whether the copy a stamp names is still there: same path, same folder. */
export const copyOpen = (stamp: Stamp) =>
  copyIdentity(stamp.copyRoot) === stamp.copyId;

/** Every file under `<root>/<dir>`, repo-relative with `/`, to its blob ID. */
export async function scanFolder(
  root: string,
  dir: string
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (abs: string) => {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(abs, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") {
        await walk(path);
      } else if (entry.isFile()) {
        const rel = relative(root, path).split(sep).join("/");
        files[rel] = blobId(await readFile(path));
      }
    }
  };
  await walk(join(root, dir));
  return files;
}

export type CopyRoot = {
  readonly root: string;
  /** The copy is part of the guest's own tree: its root, or a folder git tracks files in. */
  readonly inGuest: boolean;
};

/**
 * The copy a worker runs in. A work tree of its own (a worktree, a clone, a
 * copy with its `.git`) is its git top level. Anything else is `cwd`: a copy
 * without `.git`, which may sit in an ignored folder of the guest's repo.
 */
export async function copyRootOf(cwd: string, job: Job): Promise<CopyRoot> {
  const here = realpathSync(cwd);
  const top = await topLevel(here);
  const guest = realpathSync(job.guestRoot);
  if (top !== null && realpathSync(top) !== guest) {
    return { root: realpathSync(top), inGuest: false };
  }
  const tracked =
    top !== null &&
    nulList(await gitOut(here, ["ls-files", "-z", "--", "."])).length > 0;
  return { root: here, inGuest: here === guest || tracked };
}

export type StampOptions = {
  readonly stateDir: string;
  readonly job: Job;
  readonly part: PartId;
  readonly cwd: string;
  readonly session: string | null;
  readonly scripted: boolean;
  readonly reported: string | null;
};

export async function writeStamp(opts: StampOptions): Promise<Stamp> {
  const { root: copyRoot, inGuest } = await copyRootOf(opts.cwd, opts.job);
  const stamp: Stamp = {
    jobId: opts.job.jobId,
    part: opts.part,
    copyRoot,
    inGuest,
    copyId: copyIdentity(copyRoot) ?? "",
    session: opts.session,
    scripted: opts.scripted,
    reported: opts.reported,
    files: await scanFolder(copyRoot, opts.job.dir),
    at: now(),
  };
  const name = `${Date.now()}-${opts.part}-${randomBytes(3).toString("hex")}.json`;
  await writeJsonAtomic(join(stampsDir(opts.stateDir), name), stamp);
  return stamp;
}

export type ScriptedOutcome =
  | { readonly ok: true; readonly path: string; readonly stamp: Stamp }
  | { readonly ok: false; readonly reason: string };

/**
 * The scripted worker: writes its part into the copy at `cwd` as the job
 * gives it, stamps it, and reports done. It never runs a check. It refuses
 * only to write into the guest's repo itself.
 */
export async function scriptedWork(
  opts: Omit<StampOptions, "scripted" | "reported">
): Promise<ScriptedOutcome> {
  const { root: copyRoot, inGuest } = await copyRootOf(opts.cwd, opts.job);
  if (inGuest) {
    return {
      ok: false,
      reason: `${copyRoot} is your repo itself, not a worker's copy of it. Run me inside the copy this worker works in.`,
    };
  }
  const path = ownedPath(opts.job, opts.part);
  await mkdir(join(copyRoot, opts.job.dir), { recursive: true });
  await writeFile(join(copyRoot, path), parts[opts.part].content(opts.job));
  const stamp = await writeStamp({
    ...opts,
    scripted: true,
    reported: "done",
  });
  return { ok: true, path, stamp };
}

export const workerPath = fileURLToPath(new URL("worker.ts", import.meta.url));

const shellWord = (word: string) =>
  /^[\w./@%+=:,-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;

/** The command line for the supplied worker, e.g. `node …/worker.ts stamp a`. */
export const workerCommand = (...args: readonly string[]) =>
  ["node", workerPath, ...args].map(shellWord).join(" ");

/** The job as a boss hands it out. */
export function jobText(job: Job): string[] {
  return [
    `Split job ${job.jobId}. Three parts, each in the folder ${job.dir}/ at the root of the repo:`,
    "",
    ...partIds.flatMap((id) => [
      `Part ${id}: create ${ownedPath(job, id)}, ${parts[id].ask(job)}`,
      `  Owns: ${ownedPath(job, id)}`,
    ]),
    "",
    "Each part's worker works in its own copy of the repo. Its last step, run from inside that copy:",
    `  ${workerCommand("stamp")} <part>`,
    "",
    "The scripted worker: does any part in the copy it's run in, stamps it, says done, and exits 0. It runs no checks.",
    `  ${workerCommand()} <part>`,
  ];
}
