import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { Schema } from "effect";

import type { Env } from "./context.ts";
import { exists, readJson, tryReadJson, writeJsonAtomic } from "./store.ts";

// The launcher's session record. `pnpm pi` gives every Pi it starts a new
// workshop session ID, exports it as TMX_SESSION to that Pi and everything it
// runs, and writes one file per launch:
//
//   .workshop-state/sessions/<session>.json
//
// once when Pi starts (endedAt null) and again when it exits. An environment
// command stamps its events with `sessionFromEnv()`, so a done check can say
// which Pi did what ("consumed in a later session than the one that started
// it") by reading records, without touching the guest's code. A command run
// by hand in a plain terminal has no TMX_SESSION and stamps null.
//
// A session is one Pi process, not one conversation: relaunching resumes the
// same Pi conversation (`piSessionId`) under a new workshop session. `/reload`
// keeps the process, so it keeps the session too. A Pi started from inside
// another Pi is "nested": it records the outer one as `parentSession` and
// gets a new conversation of its own.

/** `ses_` + base36 time + 12 random hex chars. Safe as a file name. */
export const SessionId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^ses_[0-9a-z]+_[0-9a-f]{12}$/))
);

/**
 * How a Pi ended, as the launcher saw it:
 * - `quit`: exited 0 (`/quit`, Ctrl+D twice, `-p` finishing);
 * - `error`: exited non-zero;
 * - `signal`: killed by a signal, or stopped by a SIGTERM or SIGHUP the
 *   launcher passed on, even if Pi then exited 0 (`exitSignal` says which).
 */
export const SessionEnd = Schema.Literals(["quit", "error", "signal"]);
export type SessionEnd = typeof SessionEnd.Type;

export const SessionRecord = Schema.Struct({
  /** The workshop session ID, the value of TMX_SESSION. */
  session: SessionId,
  /** The TMX_SESSION of whoever ran `pnpm pi`, when a Pi started this one. */
  parentSession: Schema.NullOr(Schema.String),
  /** Pi's own session ID, or null when Pi's flags picked one we can't know. */
  piSessionId: Schema.NullOr(Schema.String),
  /** Pi's process, not the launcher's. */
  pid: Schema.Number,
  /** The `pnpm pi` launcher's process, Pi's parent. Older records lack it. */
  launcherPid: Schema.optionalKey(Schema.Number),
  role: Schema.String,
  exercise: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
  ended: Schema.NullOr(SessionEnd),
  exitCode: Schema.NullOr(Schema.Number),
  exitSignal: Schema.NullOr(Schema.String),
});
export type SessionRecord = typeof SessionRecord.Type;

export const sessionEnv = "TMX_SESSION";

export const sessionsDir = (repoRoot: string) =>
  join(repoRoot, ".workshop-state", "sessions");

export const sessionPath = (repoRoot: string, session: string) =>
  join(sessionsDir(repoRoot), `${session}.json`);

const decodeSessionId = Schema.decodeUnknownSync(SessionId);

/** A new workshop session ID, unique per call. */
export function newSessionId(at = Date.now()): string {
  return decodeSessionId(
    `ses_${at.toString(36)}_${randomBytes(6).toString("hex")}`
  );
}

/**
 * A Pi started with `pnpm pi` from a terminal, not from inside another Pi:
 * no TMX_SESSION, and no running recorded Pi among the launcher's ancestors.
 * Done checks that ask for something the guest does (quit Pi, start a fresh
 * session) count only these.
 */
export function isTopLevel(record: Pick<SessionRecord, "parentSession">) {
  return record.parentSession === null;
}

/** "1 nested session", "2 nested sessions". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The session that ran this process, or null in a plain terminal. */
export function sessionFromEnv(env: Env = process.env): string | null {
  const value = env[sessionEnv];
  return value === undefined || value === "" ? null : value;
}

export function endOf(exit: {
  readonly code: number | null;
  readonly signal: string | null;
}): SessionEnd {
  if (exit.signal !== null) {
    return "signal";
  }
  return exit.code === 0 ? "quit" : "error";
}

export async function writeSession(
  repoRoot: string,
  record: SessionRecord
): Promise<string> {
  const path = sessionPath(repoRoot, record.session);
  await writeJsonAtomic(path, record);
  return path;
}

/** Throws `StoreError` with reason `missing` for an unknown session. */
export async function readSession(
  repoRoot: string,
  session: string
): Promise<SessionRecord> {
  return readJson(
    sessionPath(repoRoot, decodeSessionId(session)),
    SessionRecord
  );
}

/**
 * Every recorded session, oldest start first. A file that doesn't parse is
 * skipped: one bad record must not hide the rest from a done check.
 */
export async function readSessions(repoRoot: string): Promise<SessionRecord[]> {
  const dir = sessionsDir(repoRoot);
  if (!(await exists(dir))) {
    return [];
  }
  const records: SessionRecord[] = [];
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const read = await tryReadJson(join(dir, name), SessionRecord);
    if (read.ok) {
      records.push(read.value);
    }
  }
  return records.toSorted(
    (a, b) =>
      a.startedAt.localeCompare(b.startedAt) ||
      a.session.localeCompare(b.session)
  );
}

export type SessionStatus = SessionEnd | "running" | "vanished";

/**
 * `running` while there's no end and Pi's PID is alive; `vanished` when there
 * is no end and the PID is gone (the launcher itself was killed, so it never
 * wrote one). An exited PID can be reused, so treat `running` on an old
 * record with suspicion.
 */
export function sessionStatus(
  record: SessionRecord,
  alive: (pid: number) => boolean = pidAlive
): SessionStatus {
  if (record.ended !== null) {
    return record.ended;
  }
  return alive(record.pid) ? "running" : "vanished";
}

export function pidAlive(pid: number): boolean {
  if (pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
