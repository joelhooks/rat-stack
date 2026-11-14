// Which recorded Pi, if any, a new `pnpm pi` was started from.
//
// TMX_SESSION says so when it's set, but anything can unset it
// (`env -u TMX_SESSION pnpm pi`), and then a Pi started from inside the guest's
// Pi looks top-level: it resumes the guest's own conversation and its work
// counts as the guest's. The process tree can't be unset, so the launcher
// also walks its parent PIDs and looks for a running Pi it recorded.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { pidAlive, type SessionRecord } from "#shared/core/sessions.ts";

/** Parent PIDs, nearest first, or null when the process tree can't be read. */
export type Ancestry = {
  readonly ancestors: () => readonly number[] | null;
  readonly alive: (pid: number) => boolean;
};

/** Longest chain the walk follows; real chains are about a dozen deep. */
const maxDepth = 128;

/**
 * `start` and its ancestors, nearest first. Stops before PID 1 (or 0), at a
 * PID it has already seen, at `maxDepth`, or where `parentOf` returns null.
 * Returns null when not even `start`'s parent can be read.
 */
export function walkAncestors(
  start: number,
  parentOf: (pid: number) => number | null
): readonly number[] | null {
  const chain: number[] = [];
  const seen = new Set<number>();
  let pid = start;
  while (pid > 1 && !seen.has(pid) && chain.length < maxDepth) {
    seen.add(pid);
    chain.push(pid);
    const parent = parentOf(pid);
    if (parent === null) {
      return chain.length === 1 ? null : chain;
    }
    pid = parent;
  }
  return chain;
}

/** Linux: field 4 of /proc/<pid>/stat, read after the `(comm)` field. */
function procParent(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const parent = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    return Number.isInteger(parent) ? parent : null;
  } catch {
    return null;
  }
}

/** Elsewhere (macOS): one `ps` call for the whole table. */
function psParents(): ((pid: number) => number | null) | null {
  try {
    const out = execFileSync("ps", ["-A", "-o", "pid=,ppid="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    const parents = new Map<number, number>();
    for (const line of out.split("\n")) {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number);
      if (Number.isInteger(pid) && Number.isInteger(ppid)) {
        parents.set(pid as number, ppid as number);
      }
    }
    return (pid) => parents.get(pid) ?? null;
  } catch {
    return null;
  }
}

/** This process's real ancestors. Never throws; null means "can't tell". */
export const systemAncestry: Ancestry = {
  ancestors: () => {
    const fromProc = walkAncestors(process.ppid, procParent);
    if (fromProc !== null) {
      return fromProc;
    }
    const parentOf = psParents();
    return parentOf === null ? null : walkAncestors(process.ppid, parentOf);
  },
  alive: pidAlive,
};

export type LiveAncestor = {
  /** The nearest running recorded Pi above this launch. */
  readonly parent: SessionRecord;
  /** The launcher of the outermost one: the guest's own `pnpm pi`. */
  readonly guestPid: number;
};

/**
 * The nearest running Pi among `ancestors` with a session record, or null.
 * A record matches when Pi's PID is in the chain, the record has no end and
 * the PID is alive. When the record names its launcher, the next PID up must
 * be that launcher, so a reused PID doesn't match.
 */
export function findLiveAncestor(
  ancestors: readonly number[],
  records: readonly SessionRecord[],
  alive: (pid: number) => boolean
): LiveAncestor | null {
  const matches: { record: SessionRecord; launcher: number | undefined }[] = [];
  ancestors.forEach((pid, i) => {
    const launcher = ancestors[i + 1];
    const record = records.find(
      (r) =>
        r.pid === pid &&
        r.ended === null &&
        (r.launcherPid === undefined || r.launcherPid === launcher)
    );
    if (record !== undefined && alive(pid)) {
      matches.push({ record, launcher });
    }
  });
  const nearest = matches[0];
  const outermost = matches.at(-1);
  if (nearest === undefined || outermost === undefined) {
    return null;
  }
  return {
    parent: nearest.record,
    guestPid:
      outermost.record.launcherPid ??
      outermost.launcher ??
      outermost.record.pid,
  };
}
