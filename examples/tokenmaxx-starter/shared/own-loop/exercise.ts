import { type CatchUpPackage, catchUp } from "#shared/core/catch-up.ts";
import {
  type CommitClaim,
  commitLine,
  commitSays,
  markStepStart,
} from "#shared/core/commit-line.ts";
import type { ExerciseContext } from "#shared/core/context.ts";
import {
  defineExercise,
  type Exercise,
  type ExerciseCommand,
} from "#shared/core/exercise.ts";
import {
  detailsFlag,
  nextAfter,
  reporter,
  type Says,
  saysOf,
  takeDetails,
} from "#shared/core/report.ts";
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
  /** The commit line `done` ends with. */
  readonly commit: (ctx: ExerciseContext) => Promise<CommitClaim>;
};

/**
 * Practice and tests: `TMX_TEST_WITHIN_MINUTES=<m>` makes `start` finish its
 * run within m minutes and drops the floor to `minFinishMs`, so neither tests
 * nor an agent practising wait minutes. The run is stamped with the window,
 * and `done` fails it: a real attempt can't use it. The readmes offer it for
 * practice, next to `TMX_STATE_DIR`: cold agents that practised on a normal
 * run sat through it, minutes of build time.
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
  commit: (ctx) => commitLine(ctx),
};

/**
 * A run on its own finishes between `defaultMinMinutes` and
 * `defaultWithinMinutes` after `start`. `testWithinEnv` sets the upper bound
 * instead and drops the floor to `minFinishMs`.
 *
 * Why 2 to 5: long enough that an agent which blocks its turn to wait leaves
 * you staring at a frozen session for minutes, which is the pain the piece is
 * about, and long enough (the floor) to quit Pi and start it again before the
 * run finishes, which 02.2 needs: in cold runs the guest quit 22 to 83 s after
 * `start`. Short, because the guest sits through one run for 02.1 and one for
 * 02.2 inside the step's slot, and a miss means another run. `release` ends a
 * run at once.
 */
export const defaultWithinMinutes = 5;
export const defaultMinMinutes = 2;

/** What `done` prints for each of 02.1's and 02.2's checks. */
const says: Readonly<Record<string, Says>> = {
  "the current run finished": {
    yes: "The current run finished.",
    no: "The current run hasn't finished yet.",
  },
  "its result was consumed exactly once": {
    yes: "The run's result was consumed exactly once.",
    no: "The run's result hasn't been consumed exactly once.",
  },
  "no stale result was consumed": {
    yes: "No old result was consumed by mistake.",
    no: "An old result was consumed by mistake.",
  },
  "the current run was started in a Pi session": {
    yes: "The current run was started in a Pi session.",
    no: "The current run wasn't started in a Pi session that counts.",
  },
  "that session quit before the run finished": {
    yes: "That session quit before the run finished.",
    no: "That session hasn't quit before the run finished.",
  },
  "its result was consumed exactly once, in a later session": {
    yes: "The run's result was consumed exactly once, in a later session.",
    no: "The run's result hasn't been consumed exactly once in a later session.",
  },
  "nobody prompted that session before the consume": {
    yes: "Nobody prompted that later session before it consumed the result.",
    no: "That later session was prompted before the consume, or there's none to check yet.",
  },
  ...commitSays,
};

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
  /** What to do after setup, from the readme. Defaults to 02.1's. */
  readonly firstStep?: string;
};

export function ownLoopExercise(
  opts: OwnLoopOptions,
  deps: OwnLoopDeps = defaultDeps
): Exercise {
  const { out, err } = deps;
  // What comes after setup, from the readme; setup and done both say it.
  const firstStep =
    opts.firstStep ??
    `start Pi with pnpm pi --exercise ${opts.id}, and have your agent start a run.`;
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
        await markStepStart(ctx, deps.now());
        await resetJob(ctx.stateDir);
        const minutesAgo = (m: number) =>
          new Date(deps.now().getTime() - m * 60_000);
        const old = await startRun(ctx.stateDir, {
          at: minutesAgo(25),
          seeded: true,
        });
        await publish(ctx.stateDir, ctx.repoRoot, old, minutesAgo(22));
        out("Job reset. No run is going.");
        out(`Next: ${firstStep}`);
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
        // A guest who never ran setup begins the step here. Card 1 builds
        // 02.1 and 02.2 at once, and nothing asks for `02.2 setup`.
        await markStepStart(ctx, deps.now());
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
      async done(ctx, args) {
        const { details } = takeDetails(args);
        const r = reporter(out, {
          id: opts.id,
          title: opts.title,
          command: `${ex(ctx, "done")} ${detailsFlag}`,
          details,
        });
        r.header();
        r.line("");
        const events = await readEvents(ctx.stateDir);
        // No run yet: every line would say so. One line instead, which tells
        // a fresh folder from one set up (setup leaves an old run behind).
        const started = fold(events).current !== null;
        const closeUnstarted = () =>
          events.length === 0
            ? r.notStarted(ex(ctx, "setup"))
            : r.end("Set up. No run has started yet.", firstStep);
        if (!started && !details) {
          closeUnstarted();
          return 1;
        }
        const verdict = await judgeEvents(ctx, events);
        const claims: readonly CommitClaim[] = [
          ...verdict.claims,
          await r.during(
            "Checking the step's commit with your commit hooks...",
            () => deps.commit(ctx)
          ),
        ];
        const { notes } = verdict;
        for (const claim of claims) {
          r.check(
            claim.ok ? "PASS" : "FAIL",
            saysOf(says, claim),
            claim.detail,
            claim.fix
          );
        }
        for (const note of notes) {
          r.aside(note);
        }
        const ok = claims.every((c) => c.ok);
        if (!started) {
          closeUnstarted();
        } else if (ok) {
          r.done(
            opts.donePass ??
              "Done: the current run's result was consumed once, and nothing stale was.",
            nextAfter(opts.id)
          );
        } else {
          r.notDone();
        }
        return ok ? 0 : 1;
      },
    },
  });
}
