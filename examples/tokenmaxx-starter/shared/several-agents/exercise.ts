import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";

import {
  detailsFlag,
  nextAfter,
  reporter,
  saysOf,
  shortPath,
} from "#shared/core/report.ts";

import {
  type CommitClaim,
  commitLine,
  commitSays,
  markStepStart,
} from "../core/commit-line.ts";
import type { ExerciseContext } from "../core/context.ts";
import { defineExercise, type Exercise } from "../core/exercise.ts";
import { buildDonePath, cast } from "./cast.ts";
import {
  type EnvState,
  envPath,
  isLive,
  readEnv,
  spawnHost,
  stopEnv,
  waitForEnv,
} from "./environment.ts";
import { judge } from "./judge.ts";
import { parkedPath } from "./stand-ins.ts";

// Several agents. The environment runs five real Pis on a scripted model,
// each in a known state; `done <command>` starts a fresh set, runs the
// guest's command once, and reads its output. It never looks at how the
// guest's tool works out a state. It ends with the shared commit line.

/** How long a `start`ed set lives if nobody stops it. */
const startLifetimeMs = 60 * 60_000;
/** How long `done`'s own set lives if `done` dies before stopping it. */
const doneLifetimeMs = 10 * 60_000;
const readyTimeoutMs = 120_000;
const commandTimeoutMs = 60_000;

/** Where the guest's command runs: where they ran `pnpm ex`. */
function commandCwd(ctx: ExerciseContext): string {
  const initCwd = process.env["INIT_CWD"];
  return initCwd !== undefined && initCwd !== "" && existsSync(initCwd)
    ? initCwd
    : ctx.guestRoot;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString();

function printEnv(out: (line: string) => void, env: EnvState | null): void {
  if (env === null) {
    out(
      "The environment's sessions: none started. `pnpm ex 05.1 start` starts them."
    );
    return;
  }
  const live = isLive(env);
  out(
    live && env.status === "ready"
      ? `The environment's sessions: running (${env.run}), until ${clock(env.stopsBy)} or \`pnpm ex 05.1 stop\`.`
      : `The environment's sessions: ${live ? env.status : env.status === "failed" ? "failed" : "stopped"} (${env.run}).`
  );
  if (env.error !== null) {
    out(`  error: ${env.error}`);
  }
  out("They're the check's own, on a scripted model, not real work:");
  for (const role of cast) {
    const s = env.sessions.find((x) => x.name === role.name);
    const ids =
      s === undefined
        ? ""
        : [s.pid === null ? null : `pid ${s.pid}`, s.piSessionId, s.session]
            .filter((x) => x !== null)
            .join("  ");
    out(`  ${role.name.padEnd(5)} ${role.doing.padEnd(36)} ${ids}`);
  }
}

/** Starts a new set, after stopping any running one. */
async function startSet(
  ctx: ExerciseContext,
  lifetimeMs: number,
  out: (line: string) => void
): Promise<EnvState> {
  const running = await readEnv(ctx.stateDir);
  if (running !== null && isLive(running)) {
    out("Stopping the set `start` left running: one set at a time.");
    await stopEnv(ctx.stateDir);
  }
  const run = spawnHost(ctx, lifetimeMs);
  return waitForEnv(ctx.stateDir, run, ["ready"], readyTimeoutMs);
}

export type CommandRun = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly ms: number;
  readonly timedOut: boolean;
};

function runCommand(command: string, cwd: string): Promise<CommandRun> {
  const started = Date.now();
  return new Promise((resolveRun) => {
    const child = spawn(command, {
      cwd,
      env: process.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, commandTimeoutMs);
    const finish = (code: number | null) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr, ms: Date.now() - started, timedOut });
    };
    child.on("error", (error) => {
      stderr += error.message;
      finish(null);
    });
    child.on("exit", (code) => finish(code));
  });
}

const indent = (text: string, max = 40) => {
  const lines = text.replace(/\s+$/, "").split("\n");
  const shown = lines.slice(0, max).map((line) => `  | ${line}`);
  if (lines.length > max) {
    shown.push(`  | ... ${lines.length - max} more lines`);
  }
  return shown.join("\n");
};

export type SeveralAgentsDeps = {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly now: () => Date;
  readonly startSet: (
    ctx: ExerciseContext,
    lifetimeMs: number,
    out: (line: string) => void
  ) => Promise<EnvState>;
  readonly stopSet: (stateDir: string) => Promise<EnvState | null>;
  readonly runCommand: (command: string, cwd: string) => Promise<CommandRun>;
  readonly commit: (ctx: ExerciseContext) => Promise<CommitClaim>;
};

export const defaultDeps: SeveralAgentsDeps = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  now: () => new Date(),
  startSet,
  stopSet: stopEnv,
  runCommand,
  commit: (ctx) => commitLine(ctx),
};

async function done(
  ctx: ExerciseContext,
  argv: readonly string[],
  deps: SeveralAgentsDeps,
  title: string
): Promise<number> {
  const { out } = deps;
  // `--details` is ours only before the guest's command starts: after
  // that, every word is theirs.
  let first = 0;
  while (argv[first] === detailsFlag) {
    first += 1;
  }
  const details = first > 0;
  const command = argv.slice(first).join(" ").trim();
  if (command === "") {
    deps.err("Give your command: pnpm ex 05.1 done <your command>");
    return 2;
  }
  const where = commandCwd(ctx);
  const r = reporter(out, {
    id: ctx.exerciseId,
    title,
    command: `pnpm ex ${ctx.exerciseId} done --details ${command}`,
    details,
  });
  r.header(`running \`${command}\` in ${shortPath(where)}`);
  r.line("");
  let env: EnvState;
  try {
    env = await r.during("Starting the environment's five sessions...", () =>
      deps.startSet(ctx, doneLifetimeMs, r.line)
    );
  } catch (error) {
    r.check("FAIL", "The environment's sessions didn't start.", String(error));
    r.end(
      "Not done yet: the environment's sessions didn't start.",
      "run this again."
    );
    return 1;
  }
  let ran: CommandRun;
  try {
    if (env.status !== "ready") {
      r.check(
        "FAIL",
        "The environment's sessions didn't start.",
        env.error ?? env.status
      );
      r.end(
        "Not done yet: the environment's sessions didn't start.",
        "run this again."
      );
      return 1;
    }
    ran = await r.during(`Running \`${command}\`...`, () =>
      deps.runCommand(command, where)
    );
  } finally {
    await deps.stopSet(ctx.stateDir);
  }
  const claims = judge(ran.stdout, env.sessions);
  const commit = await r.during(
    "Checking the step's commit with your commit hooks...",
    () => deps.commit(ctx)
  );
  const ok = claims.every((c) => c.ok) && commit.ok;
  // What the command printed: the claims judge it, so it shows with any FAIL.
  if (details || !claims.every((c) => c.ok)) {
    r.line(
      `Ran \`${command}\` in ${shortPath(where)}: ${ran.timedOut ? `stopped after ${commandTimeoutMs / 1000}s` : `exit ${ran.code ?? "on a signal"}`}, ${(ran.ms / 1000).toFixed(1)}s. Its output:`
    );
    r.line(indent(ran.stdout === "" ? "(nothing on stdout)" : ran.stdout));
    if (ran.stderr.trim() !== "") {
      r.line("Its stderr:");
      r.line(indent(ran.stderr, 10));
    }
    r.line("");
  }
  for (const claim of claims) {
    r.check(claim.ok ? "PASS" : "FAIL", claim.text);
  }
  r.check(
    commit.ok ? "PASS" : "FAIL",
    saysOf(commitSays, commit),
    commit.detail,
    commit.fix
  );
  if (ok) {
    r.done("Done.", nextAfter(ctx.exerciseId));
  } else {
    r.notDone();
  }
  return ok ? 0 : 1;
}

export function severalAgentsExercise(
  opts: { readonly id: string; readonly title: string },
  deps: SeveralAgentsDeps = defaultDeps
): Exercise {
  const { out } = deps;
  return defineExercise({
    id: opts.id,
    title: opts.title,
    commands: {
      setup: async (ctx) => {
        await markStepStart(ctx, deps.now());
        await deps.stopSet(ctx.stateDir);
        for (const path of [
          envPath(ctx.stateDir),
          parkedPath(ctx.stateDir),
          buildDonePath(ctx.stateDir),
        ]) {
          await rm(path, { force: true });
        }
        out("Stopped the environment's sessions and cleared its state.");
        return 0;
      },
      status: async (ctx) => {
        printEnv(out, await readEnv(ctx.stateDir));
        return 0;
      },
      start: async (ctx) => {
        // Whichever of setup and start comes first begins the step.
        await markStepStart(ctx, deps.now());
        const env = await deps.startSet(ctx, startLifetimeMs, out);
        printEnv(out, env);
        return env.status === "ready" ? 0 : 1;
      },
      stop: async (ctx) => {
        printEnv(out, await deps.stopSet(ctx.stateDir));
        return 0;
      },
      done: (ctx, args) => done(ctx, args, deps, opts.title),
    },
  });
}
