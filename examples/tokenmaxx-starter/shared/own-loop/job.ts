import { spawn } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import { inputFixturePath } from "#shared/core/fixtures.ts";
import { newRunId, resultIdFor } from "#shared/core/ids.ts";
import {
  isTopLevel,
  plural,
  type SessionRecord,
} from "#shared/core/sessions.ts";
import {
  isTempFile,
  readJson,
  tryReadJson,
  writeJsonAtomic,
} from "#shared/core/store.ts";

import { countStats, encodeStats, Stats } from "./stats.ts";

// The loop piece's job: a run that finishes at a time nobody is told. It does
// none of the guest's work for them:
// `consume` records every call, repeats and old runs' results included, and
// the done check judges afterwards.
//
// State lives under the exercise's state dir:
//   events/<ms>-<hex>.json   one file per event, written once, never edited.
//                            The timer and the guest's consume can write at
//                            the same moment without losing either.
//   result.json              the latest published result, any run's. A real
//                            job's output file: an old run's sits there until
//                            a new one replaces it.

/**
 * The workshop session (TMX_SESSION) whose command wrote the event, or null
 * from a plain terminal or the job's own timer. See shared/core/sessions.ts.
 */
const session = Schema.optionalKey(Schema.NullOr(Schema.String));

export const RunStarted = Schema.TaggedStruct("RunStarted", {
  runId: Schema.String,
  at: Schema.String,
  /** Left behind by setup: a run from before this attempt. Never current. */
  seeded: Schema.Boolean,
  session,
  /**
   * Set when TMX_TEST_WITHIN_MINUTES shortened the run. A done check never
   * counts such a run: it's for tests and reference passes only.
   */
  testWindowMinutes: Schema.optionalKey(Schema.Number),
});
export const ResultPublished = Schema.TaggedStruct("ResultPublished", {
  runId: Schema.String,
  resultId: Schema.String,
  stats: Stats,
  at: Schema.String,
  session,
});
export const ResultConsumed = Schema.TaggedStruct("ResultConsumed", {
  resultId: Schema.String,
  at: Schema.String,
  session,
});
export const JobEvent = Schema.Union([
  RunStarted,
  ResultPublished,
  ResultConsumed,
]);
export type JobEvent = typeof JobEvent.Type;
export type ResultPublished = typeof ResultPublished.Type;

/** What `result.json` holds. */
export const LatestResult = Schema.Struct({
  runId: Schema.String,
  resultId: Schema.String,
  stats: Stats,
  publishedAt: Schema.String,
});
export type LatestResult = typeof LatestResult.Type;

export const eventsDir = (stateDir: string) => join(stateDir, "events");
export const resultPath = (stateDir: string) => join(stateDir, "result.json");

let lastStamp = 0;

/** Appends one event. File names sort in write order within one process. */
export async function appendEvent(
  stateDir: string,
  event: JobEvent
): Promise<void> {
  const stamp = Math.max(Date.now(), lastStamp + 1);
  lastStamp = stamp;
  const suffix = Math.random().toString(16).slice(2, 10).padEnd(8, "0");
  const name = `${String(stamp).padStart(15, "0")}-${suffix}.json`;
  await writeJsonAtomic(join(eventsDir(stateDir), name), event);
}

/** Every event, oldest first. No events dir means no events. */
export async function readEvents(stateDir: string): Promise<JobEvent[]> {
  let names: string[];
  try {
    names = await readdir(eventsDir(stateDir));
  } catch {
    return [];
  }
  const files = names
    .filter((name) => name.endsWith(".json") && !isTempFile(name))
    .toSorted();
  const events: JobEvent[] = [];
  for (const name of files) {
    events.push(await readJson(join(eventsDir(stateDir), name), JobEvent));
  }
  return events;
}

export type RunView = {
  readonly runId: string;
  readonly startedAt: string;
  readonly seeded: boolean;
  /** The session that started it, or null. */
  readonly session: string | null;
  /** The test-only window it ran under, in minutes, or null for a real run. */
  readonly testWindow: number | null;
  readonly result: ResultPublished | null;
};

export type ConsumeView = {
  readonly resultId: string;
  readonly at: string;
  /** The run that published it. */
  readonly runId: string | null;
  /** That run was left behind by setup. */
  readonly seeded: boolean;
  /** The newest run when it was consumed. */
  readonly currentRunThen: string | null;
  /** The session that consumed it, or null. */
  readonly session: string | null;
};

export type JobState = {
  readonly runs: readonly RunView[];
  readonly current: RunView | null;
  readonly consumed: readonly ConsumeView[];
};

/** Folds the event log into runs, the current run and every consume. */
export function fold(events: readonly JobEvent[]): JobState {
  const runs = new Map<string, RunView>();
  const publishedBy = new Map<string, string>();
  const consumed: ConsumeView[] = [];
  let current: string | null = null;
  for (const event of events) {
    switch (event._tag) {
      case "RunStarted":
        runs.set(event.runId, {
          runId: event.runId,
          startedAt: event.at,
          seeded: event.seeded,
          session: event.session ?? null,
          testWindow: event.testWindowMinutes ?? null,
          result: null,
        });
        if (!event.seeded) {
          current = event.runId;
        }
        break;
      case "ResultPublished": {
        const run = runs.get(event.runId);
        if (run !== undefined && run.result === null) {
          runs.set(event.runId, { ...run, result: event });
          publishedBy.set(event.resultId, event.runId);
        }
        break;
      }
      case "ResultConsumed": {
        const runId = publishedBy.get(event.resultId) ?? null;
        consumed.push({
          resultId: event.resultId,
          at: event.at,
          runId,
          seeded: runId !== null && runs.get(runId)?.seeded === true,
          currentRunThen: current,
          session: event.session ?? null,
        });
        break;
      }
    }
  }
  return {
    runs: [...runs.values()],
    current: current === null ? null : (runs.get(current) ?? null),
    consumed,
  };
}

export type Claim = {
  readonly ok: boolean;
  readonly name: string;
  readonly detail: string;
};

/**
 * A done check's answer: its claims, plus neutral notes about what it saw and
 * didn't count. A note never fails anything.
 */
export type Verdict = {
  readonly claims: readonly Claim[];
  readonly notes: readonly string[];
};

/**
 * Splits consumes into the ones a top-level Pi session made (a Pi the guest
 * started with `pnpm pi`) and the rest: a plain terminal, a Pi started from
 * inside another Pi, or a session with no record.
 */
export function splitConsumes(
  consumed: readonly ConsumeView[],
  sessions: readonly SessionRecord[]
): { counted: ConsumeView[]; ignored: ConsumeView[] } {
  const byId = new Map(sessions.map((s) => [s.session, s]));
  const counted: ConsumeView[] = [];
  const ignored: ConsumeView[] = [];
  for (const c of consumed) {
    const record = c.session === null ? undefined : byId.get(c.session);
    (record !== undefined && isTopLevel(record) ? counted : ignored).push(c);
  }
  return { counted, ignored };
}

/** The line a done check prints for a run started under the test window. */
export const testWindowDetail = (runId: string, minutes: number) =>
  `${runId} used the test-only window (TMX_TEST_WITHIN_MINUTES=${minutes}); start a normal run`;

export function ignoredConsumesNote(ignored: number): readonly string[] {
  return ignored === 0
    ? []
    : [
        `Note: ${plural(ignored, "consume")} from outside a top-level Pi session not counted`,
      ];
}

/**
 * The done check. It reads what happened to the job and which Pi session did
 * it, never how the agent waited. Only consumes made in a top-level Pi
 * session count; the rest are noted.
 *
 * 1. the current run, the newest one started, has finished;
 * 2. its result was consumed exactly once;
 * 3. no consume ever took a stale result: one from a run setup left behind,
 *    or from a run that was not the newest at the moment it was consumed.
 */
export function judge(
  events: readonly JobEvent[],
  sessions: readonly SessionRecord[]
): Verdict {
  const folded = fold(events);
  const { current } = folded;
  const { counted: consumed, ignored } = splitConsumes(
    folded.consumed,
    sessions
  );
  const finishedName = "the current run finished";
  const finished: Claim =
    current === null
      ? { ok: false, name: finishedName, detail: "no run yet" }
      : current.testWindow !== null
        ? {
            ok: false,
            name: finishedName,
            detail: testWindowDetail(current.runId, current.testWindow),
          }
        : current.result === null
          ? {
              ok: false,
              name: finishedName,
              detail: `${current.runId} is still running`,
            }
          : {
              ok: true,
              name: finishedName,
              detail: `${current.runId} published ${current.result.resultId}`,
            };
  const result = current?.result ?? null;
  const times =
    result === null
      ? 0
      : consumed.filter((c) => c.resultId === result.resultId).length;
  const elsewhere =
    result === null
      ? 0
      : ignored.filter((c) => c.resultId === result.resultId).length;
  const once: Claim = {
    ok: result !== null && times === 1,
    name: "its result was consumed exactly once",
    detail:
      result === null
        ? "nothing to consume yet"
        : times === 0 && elsewhere > 0
          ? `${result.resultId} was consumed only from outside a top-level Pi session`
          : `${result.resultId} consumed ${plural(times, "time")}`,
  };
  return {
    claims: [finished, once, freshClaim(consumed)],
    notes: ignoredConsumesNote(ignored.length),
  };
}

/**
 * No consume ever took a stale result: one from a run setup left behind, or
 * from a run that was not the newest at the moment it was consumed.
 */
export function freshClaim(consumed: readonly ConsumeView[]): Claim {
  const stale = consumed.filter(
    (c) => c.runId !== null && (c.seeded || c.runId !== c.currentRunThen)
  );
  return {
    ok: stale.length === 0,
    name: "no stale result was consumed",
    detail:
      stale.length === 0
        ? "every consume took the newest run's result"
        : stale
            .map((c) =>
              c.seeded
                ? `${c.resultId} from ${c.runId}, a run from before setup`
                : `${c.resultId} from ${c.runId}, consumed while ${c.currentRunThen ?? "no run"} was current`
            )
            .join("; "),
  };
}

/** The job's work: count the input fixture. */
export async function computeResult(repoRoot: string, runId: string) {
  const text = await readFile(inputFixturePath({ repoRoot }), "utf8");
  const stats = countStats(text);
  // SAFETY: every runId here comes from newRunId; resultIdFor only hashes it.
  const resultId = resultIdFor(runId as never, encodeStats(stats));
  return { resultId: String(resultId), stats };
}

/**
 * Finishes `runId`: publishes its result and overwrites `result.json`.
 * Returns null when the run is unknown (the job was reset) or already done.
 */
export async function publish(
  stateDir: string,
  repoRoot: string,
  runId: string,
  when = new Date(),
  by: string | null = null
): Promise<ResultPublished | null> {
  const run = fold(await readEvents(stateDir)).runs.find(
    (r) => r.runId === runId
  );
  if (run === undefined || run.result !== null) {
    return null;
  }
  const { resultId, stats } = await computeResult(repoRoot, runId);
  const at = when.toISOString();
  const event: ResultPublished = {
    _tag: "ResultPublished",
    runId,
    resultId,
    stats,
    at,
    session: by,
  };
  await appendEvent(stateDir, event);
  await writeJsonAtomic(resultPath(stateDir), {
    runId,
    resultId,
    stats,
    publishedAt: at,
  } satisfies LatestResult);
  return event;
}

/** Starts a new run. The previous one, if still going, keeps going. */
export async function startRun(
  stateDir: string,
  opts: {
    readonly at?: Date;
    readonly seeded?: boolean;
    readonly session?: string | null;
    readonly testWindowMinutes?: number;
  } = {}
) {
  const runId = String(newRunId());
  await appendEvent(stateDir, {
    _tag: "RunStarted",
    runId,
    at: (opts.at ?? new Date()).toISOString(),
    seeded: opts.seeded ?? false,
    session: opts.session ?? null,
    ...(opts.testWindowMinutes === undefined
      ? {}
      : { testWindowMinutes: opts.testWindowMinutes }),
  });
  return runId;
}

/** Records one consume, whatever it is. Judging comes later. */
export async function recordConsume(
  stateDir: string,
  resultId: string,
  by: string | null = null
) {
  await appendEvent(stateDir, {
    _tag: "ResultConsumed",
    resultId,
    at: new Date().toISOString(),
    session: by,
  });
}

/** Empties the job's state. */
export async function resetJob(stateDir: string): Promise<void> {
  await rm(eventsDir(stateDir), { recursive: true, force: true });
  await rm(resultPath(stateDir), { force: true });
}

export async function readLatestResult(
  stateDir: string
): Promise<LatestResult | null> {
  const read = await tryReadJson(resultPath(stateDir), LatestResult);
  if (read.ok) {
    return read.value;
  }
  if (read.error.reason === "missing") {
    return null;
  }
  throw read.error;
}

const finishLaterEntry = fileURLToPath(
  new URL("./finish-later.ts", import.meta.url)
);

/** The shortest wait before a timed run finishes on its own. */
export const minFinishMs = 20_000;

/** A moment between `minMs` and `maxMs`, never below `minFinishMs`. */
export function pickDelay(
  maxMs: number,
  random = Math.random(),
  minMs = minFinishMs
): number {
  const min = Math.max(minMs, minFinishMs);
  const max = Math.max(maxMs, min);
  return Math.round(min + random * (max - min));
}

/**
 * Starts a detached process that finishes `runId` at a random moment between
 * `minMs` and `maxMs` from now. It picks the moment itself and writes it
 * nowhere, and it outlives this command and the agent's tool call. It exits
 * by itself within a second or so of the run finishing or being reset away.
 * Returns its PID.
 */
export function spawnFinisher(
  repoRoot: string,
  stateDir: string,
  runId: string,
  maxMs: number,
  minMs: number = minFinishMs
): number | null {
  const child = spawn(
    process.execPath,
    [finishLaterEntry, stateDir, runId, String(maxMs), String(minMs)],
    { cwd: repoRoot, detached: true, stdio: "ignore" }
  );
  child.unref();
  return child.pid ?? null;
}
