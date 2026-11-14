import { type CatchUpPackage, catchUp } from "#shared/core/catch-up.ts";
import type { ExerciseContext } from "#shared/core/context.ts";
import {
  defineExercise,
  type Exercise,
  type ExerciseCommand,
} from "#shared/core/exercise.ts";
import {
  readSessions,
  type SessionRecord,
  sessionFromEnv,
} from "#shared/core/sessions.ts";

import {
  fold,
  type JobEvent,
  judge,
  publish,
  readEvents,
  readLatestResult,
  recordConsume,
  resetJob,
  spawnFinisher,
  startRun,
  type Verdict,
} from "./job.ts";
import { formatStats } from "./stats.ts";

/**
 * A working wait, for `catch-up`: pinned in `.pi/settings.json`, off until
 * then. The next piece's readme names the command; this one's doesn't.
 */
export const waitPackage: CatchUpPackage = {
  piece: "a wait that wakes the agent",
  source: "git:github.com/joelhooks/pi-until",
  url: "https://github.com/joelhooks/pi-until",
};

// The commands for the loop piece. They tell the agent about the job and nothing about
// how to wait for it. `done` judges what happened to the job, not how.

export type OwnLoopDeps = {
  /** Starts the detached timer that finishes a run later. */
  readonly spawnFinisher: typeof spawnFinisher;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly now: () => Date;
  /** The workshop session running this command (TMX_SESSION), or null. */
  readonly session: () => string | null;
  /** The raw value of `testWithinEnv`, for tests and reference passes. */
  readonly testWithin: () => string | undefined;
  /** The launcher's session records, for the done check. */
  readonly readSessions: (repoRoot: string) => Promise<SessionRecord[]>;
};

/**
 * Test-only: `TMX_TEST_WITHIN_MINUTES=<m>` makes `start` finish its run
 * within m minutes and drops the floor to `minFinishMs`, so tests don't wait
 * minutes. The run is stamped with the window, and `done` fails it: a real
 * attempt can't use it. No readme or help mentions it.
 */
export const testWithinEnv = "TMX_TEST_WITHIN_MINUTES";

const defaultDeps: OwnLoopDeps = {
  spawnFinisher,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  now: () => new Date(),
  session: () => sessionFromEnv(),
  testWithin: () => process.env[testWithinEnv],
  readSessions,
};

/**
 * A run on its own finishes between `defaultMinMinutes` and
 * `defaultWithinMinutes` after `start`. `testWithinEnv` sets the upper bound
 * instead and drops the floor to `minFinishMs`.
 *
 * Why 3 to 8: long enough that an agent which blocks its turn to wait leaves
 * you staring at a frozen session for minutes, which is the pain the piece is
 * about, and long enough (the floor) to quit Pi and start it again before the
 * run finishes, which 02.2 needs. Short enough that the worst case still
 * leaves time for a second attempt in the slot, and `release` ends a run at
 * once.
 */
export const defaultWithinMinutes = 8;
export const defaultMinMinutes = 3;

const ex = (ctx: ExerciseContext, command: string) =>
  `pnpm ex ${ctx.exerciseId} ${command}`;

function ago(iso: string, now: Date): string {
  const seconds = Math.max(
    0,
    Math.round((now.getTime() - Date.parse(iso)) / 1000)
  );
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m === 0 ? `${s}s ago` : `${m}m ${s}s ago`;
}

type Window = { readonly within: number; readonly minMs: number | undefined };

function parseWithin(raw: string | undefined): Window | string {
  if (raw === undefined || raw === "") {
    return { within: defaultWithinMinutes, minMs: defaultMinMinutes * 60_000 };
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0
    ? { within: value, minMs: undefined }
    : `${testWithinEnv} takes a number of minutes, e.g. 0.5`;
}

export type OwnLoopOptions = {
  readonly id: string;
  readonly title: string;
  /** The done check's claims. Defaults to 02.1's: `judge` in ./job.ts. */
  readonly judge?: (
    ctx: ExerciseContext,
    events: readonly JobEvent[]
  ) => Promise<Verdict>;
  /** What `done` prints when every claim holds. */
  readonly donePass?: string;
  /** Adds `catch-up`, which switches on `waitPackage`. */
  readonly catchUp?: boolean;
};

export function ownLoopExercise(
  opts: OwnLoopOptions,
  deps: OwnLoopDeps = defaultDeps
): Exercise {
  const { out, err } = deps;
  const judgeEvents =
    opts.judge ??
    (async (ctx: ExerciseContext, events: readonly JobEvent[]) =>
      judge(events, await deps.readSessions(ctx.repoRoot)));
  // Switches on a working wait. Not in the exercise's readme; the next one's.
  const extra: Record<string, ExerciseCommand> =
    opts.catchUp === true ? { "catch-up": catchUp(waitPackage, { out }) } : {};
  return defineExercise({
    id: opts.id,
    title: opts.title,
    commands: {
      /** Resets the job. A run from before is left behind, as on any machine. */
      async setup(ctx) {
        await resetJob(ctx.stateDir);
        const minutesAgo = (m: number) =>
          new Date(deps.now().getTime() - m * 60_000);
        const old = await startRun(ctx.stateDir, {
          at: minutesAgo(25),
          seeded: true,
        });
        await publish(ctx.stateDir, ctx.repoRoot, old, minutesAgo(22));
        out("Job reset. No run is going.");
        out(`Next: ${ex(ctx, "start")}`);
        return 0;
      },

      /** Starts a run that finishes at a random time nobody is told. */
      async start(ctx, args) {
        if (args.length > 0) {
          err(`start takes no options. Usage: ${ex(ctx, "start")}`);
          return 2;
        }
        const window = parseWithin(deps.testWithin());
        if (typeof window === "string") {
          err(window);
          return 2;
        }
        const { within } = window;
        const before = fold(await readEvents(ctx.stateDir)).current;
        // The test window drops the floor; a real run keeps it.
        const testWindow = window.minMs === undefined;
        const runId = await startRun(ctx.stateDir, {
          session: deps.session(),
          ...(testWindow ? { testWindowMinutes: within } : {}),
        });
        deps.spawnFinisher(
          ctx.repoRoot,
          ctx.stateDir,
          runId,
          Math.round(within * 60_000),
          window.minMs
        );
        out(
          `Started ${runId}. It finishes on its own some time in the next ${within} minute${within === 1 ? "" : "s"}.`
        );
        if (testWindow) {
          out(
            `${testWithinEnv} is set: this is a test run, and done won't count it.`
          );
        }
        if (before !== null && before.result === null) {
          out(`${before.runId} was still going. It may still finish.`);
        }
        out(`To finish it now, from any terminal: ${ex(ctx, "release")}`);
        return 0;
      },

      /** Finishes the current run now. */
      async release(ctx) {
        const current = fold(await readEvents(ctx.stateDir)).current;
        if (current === null) {
          err(`No run is going. Start one: ${ex(ctx, "start")}`);
          return 1;
        }
        if (current.result !== null) {
          out(`${current.runId} already finished.`);
          return 0;
        }
        await publish(
          ctx.stateDir,
          ctx.repoRoot,
          current.runId,
          deps.now(),
          deps.session()
        );
        out(`Released ${current.runId}: it finished.`);
        return 0;
      },

      /** What the job looks like right now. Reads only. */
      async status(ctx) {
        const now = deps.now();
        const { current, consumed } = fold(await readEvents(ctx.stateDir));
        const latest = await readLatestResult(ctx.stateDir);
        out(
          current === null
            ? "Current run:  none"
            : current.result === null
              ? `Current run:  ${current.runId}, started ${ago(current.startedAt, now)}, still running`
              : `Current run:  ${current.runId}, started ${ago(current.startedAt, now)}, finished ${ago(current.result.at, now)}: ${current.result.resultId}`
        );
        out(
          latest === null
            ? "result.json:  none"
            : `result.json:  ${latest.resultId} from ${latest.runId}, published ${ago(latest.publishedAt, now)}`
        );
        const counts = new Map<string, number>();
        for (const c of consumed) {
          counts.set(c.resultId, (counts.get(c.resultId) ?? 0) + 1);
        }
        out(
          counts.size === 0
            ? "Consumed:     none"
            : `Consumed:     ${[...counts].map(([id, n]) => `${id} (${n}x)`).join(", ")}`
        );
        return 0;
      },

      /** Uses a result. Records every call; `done` judges them. */
      async consume(ctx, args) {
        const resultId = args[0];
        if (resultId === undefined || resultId.startsWith("-")) {
          err(`Usage: ${ex(ctx, "consume")} <resultId>`);
          return 2;
        }
        const { runs } = fold(await readEvents(ctx.stateDir));
        const run = runs.find((r) => r.result?.resultId === resultId);
        if (run?.result == null) {
          err(`No published result ${resultId}. Nothing consumed.`);
          return 1;
        }
        await recordConsume(ctx.stateDir, resultId, deps.session());
        out(
          `Consumed ${resultId} from ${run.runId}: ${formatStats(run.result.stats)}`
        );
        return 0;
      },

      ...extra,

      /** The done check: PASS only when every claim holds. */
      async done(ctx) {
        const { claims, notes } = await judgeEvents(
          ctx,
          await readEvents(ctx.stateDir)
        );
        for (const claim of claims) {
          out(`${claim.ok ? "PASS" : "FAIL"}  ${claim.name}`);
          out(`      ${claim.detail}`);
        }
        for (const note of notes) {
          out(note);
        }
        const ok = claims.every((c) => c.ok);
        out(
          ok
            ? (opts.donePass ??
                "Done: the current run's result was consumed once, and nothing stale was.")
            : `Not done yet. Start over any time with ${ex(ctx, "setup")}.`
        );
        return ok ? 0 : 1;
      },
    },
  });
}
