import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "effect";

import type { ExerciseContext } from "../core/context.ts";
import { now } from "../core/paths.ts";
import { pidAlive, readSessions, sessionPath } from "../core/sessions.ts";
import { tryReadJson, writeJsonAtomic } from "../core/store.ts";
import { turnsPath } from "../core/turns.ts";
import { buildDonePath, cast, type Role, scriptsFor } from "./cast.ts";
import { startScriptedModel } from "./scripted-model.ts";
import { parkedPath } from "./stand-ins.ts";

// The environment's host: one detached process that serves the scripted
// model, starts the cast through the real launcher (`scripts/pi.ts`) with
// Pi in RPC mode, drives each session into its state, kills the one that
// should be stopped, and holds the rest there until it's told to stop. Its
// state is `env.json` in the exercise's state dir.
//
// It's started through a short-lived middle process, so it has no parent
// left when it starts the cast: run from inside the guest's Pi, the
// launcher would otherwise count every one of them as nested.

export const EnvStatus = Schema.Literals([
  "starting",
  "ready",
  "failed",
  "stopping",
  "stopped",
]);
export type EnvStatus = typeof EnvStatus.Type;

export const EnvSession = Schema.Struct({
  name: Schema.String,
  /** The workshop session (TMX_SESSION), once the launcher recorded it. */
  session: Schema.NullOr(Schema.String),
  piSessionId: Schema.NullOr(Schema.String),
  /** Pi's process, once the launcher recorded it. */
  pid: Schema.NullOr(Schema.Number),
  launcherPid: Schema.Number,
});
export type EnvSession = typeof EnvSession.Type;

export const EnvState = Schema.Struct({
  run: Schema.String,
  hostPid: Schema.Number,
  status: EnvStatus,
  error: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  /** When the host stops the set by itself. */
  stopsBy: Schema.String,
  sessions: Schema.Array(EnvSession),
});
export type EnvState = typeof EnvState.Type;

export const envPath = (stateDir: string) => join(stateDir, "env.json");
const logPath = (stateDir: string) => join(stateDir, "host.log");
const hostPath = fileURLToPath(import.meta.url);

/** The current state, or null when nothing was ever started here. */
export async function readEnv(stateDir: string): Promise<EnvState | null> {
  const read = await tryReadJson(envPath(stateDir), EnvState);
  return read.ok ? read.value : null;
}

/** True while a host may still be holding sessions. */
export const isLive = (env: EnvState | null): boolean =>
  env !== null &&
  (env.status === "starting" ||
    env.status === "ready" ||
    env.status === "stopping") &&
  pidAlive(env.hostPid);

/** PID → parent PID for every process, from one `ps` call. */
function processTable(): Map<number, number> {
  const parents = new Map<number, number>();
  try {
    const out = execFileSync("ps", ["-A", "-o", "pid=,ppid="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    for (const line of out.split("\n")) {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number);
      if (Number.isInteger(pid) && Number.isInteger(ppid)) {
        parents.set(pid as number, ppid as number);
      }
    }
  } catch {
    // No table: only the processes we know by PID get stopped.
  }
  return parents;
}

/** Every process below `pid`, from one table. */
export function descendants(
  pid: number,
  table: ReadonlyMap<number, number> = processTable()
): number[] {
  const found: number[] = [];
  const queue = [pid];
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const [child, ppid] of table) {
      if (ppid === parent && !found.includes(child)) {
        found.push(child);
        queue.push(child);
      }
    }
  }
  return found;
}

const kill = (pid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(pid, signal);
  } catch {
    // Already gone.
  }
};

const sleep = (ms: number) =>
  new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

// --- The host ---------------------------------------------------------------

type Member = {
  readonly role: Role;
  readonly launcher: ChildProcess;
  readonly launcherPid: number;
  session: string | null;
  piSessionId: string | null;
  pid: number | null;
  ready: boolean;
  exited: boolean;
  stderr: string;
};

/** Dialogs a guest's extension may open; nobody is there to answer them. */
const dialogs = new Set(["select", "confirm", "input", "editor"]);

/** Starts the cast, holds it until a signal or `lifetimeMs`, then stops it. */
export async function runHost(
  repoRoot: string,
  stateDir: string,
  run: string,
  lifetimeMs: number
): Promise<void> {
  const startedAt = now();
  const stopsBy = new Date(Date.now() + lifetimeMs).toISOString();
  const members: Member[] = [];
  let status: EnvStatus = "starting";
  let error: string | null = null;
  const save = () =>
    writeJsonAtomic(envPath(stateDir), {
      run,
      hostPid: process.pid,
      status,
      error,
      startedAt,
      stopsBy,
      sessions: members.map((m) => ({
        name: m.role.name,
        session: m.session,
        piSessionId: m.piSessionId,
        pid: m.pid,
        launcherPid: m.launcherPid,
      })),
    } satisfies EnvState);

  await save();
  await rm(parkedPath(stateDir), { force: true });
  await rm(buildDonePath(stateDir), { force: true });
  const model = await startScriptedModel(scriptsFor(stateDir));

  let stopping: Promise<void> | null = null;
  const stop = (final: EnvStatus) => {
    stopping ??= (async () => {
      status = "stopping";
      await save().catch(() => undefined);
      await stopMembers(members);
      await model.close();
      for (const m of members) {
        if (m.session !== null) {
          await rm(sessionPath(repoRoot, m.session), { force: true });
          await rm(turnsPath(repoRoot, m.session), { force: true });
        }
      }
      status = final;
      await save().catch(() => undefined);
    })();
    return stopping;
  };
  const onSignal = () => void stop("stopped").then(() => process.exit(0));
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  process.on("SIGHUP", onSignal);

  try {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PI_SKIP_VERSION_CHECK: "1",
    };
    // Top-level sessions, as if the guest had started each from a terminal.
    delete env["TMX_SESSION"];
    delete env["TMX_GUEST_PI_PID"];
    delete env["TMX_ROLE"];
    for (const role of cast) {
      members.push(
        startMember(repoRoot, role, {
          ...env,
          TMX_PROBE_URL: model.urlFor(role.name),
        })
      );
    }
    await save();
    await allReady(repoRoot, members, 90_000);
    const killed = members.filter((m) => m.role.kind === "killed");
    for (const m of killed) {
      // A crash: Pi dies at once, mid tool call, and its launcher sees it.
      const below = descendants(m.pid ?? -1);
      kill(m.pid ?? -1, "SIGKILL");
      for (const pid of below) {
        kill(pid, "SIGKILL");
      }
    }
    await until(
      () => killed.every((m) => m.exited),
      15_000,
      "a killed session's launcher to exit"
    );
    status = "ready";
    await save();
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
    await stop("failed");
    process.exit(1);
  }

  await sleep(lifetimeMs);
  await stop("stopped");
  process.exit(0);
}

function startMember(
  repoRoot: string,
  role: Role,
  env: NodeJS.ProcessEnv
): Member {
  const launcher = spawn(
    process.execPath,
    [
      join(repoRoot, "scripts", "pi.ts"),
      "--exercise",
      "05.1",
      "--role",
      role.name,
      "--",
      "--mode",
      "rpc",
      "--approve",
      "-e",
      fileURLToPath(
        new URL("../first-package/probe-provider.ts", import.meta.url)
      ),
      "-e",
      fileURLToPath(new URL("./stand-ins.ts", import.meta.url)),
      "--model",
      "probe/probe",
    ],
    { cwd: repoRoot, env, stdio: ["pipe", "pipe", "pipe"] }
  );
  if (launcher.pid === undefined) {
    throw new Error(`could not start ${role.name}'s launcher`);
  }
  const member: Member = {
    role,
    launcher,
    launcherPid: launcher.pid,
    session: null,
    piSessionId: null,
    pid: null,
    ready: false,
    exited: false,
    stderr: "",
  };
  launcher.on("exit", () => {
    member.exited = true;
  });
  launcher.stderr?.on("data", (chunk: Buffer) => {
    member.stderr = (member.stderr + chunk.toString()).slice(-2000);
  });
  // RPC records are JSON lines split on LF only.
  let buffer = "";
  launcher.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const end = buffer.indexOf("\n");
      if (end === -1) {
        break;
      }
      const line = buffer.slice(0, end).replace(/\r$/, "");
      buffer = buffer.slice(end + 1);
      onRecord(member, line);
    }
  });
  launcher.stdin?.on("error", () => undefined);
  launcher.stdin?.write(
    `${JSON.stringify({ id: "prompt", type: "prompt", message: role.prompt })}\n`
  );
  return member;
}

function onRecord(member: Member, line: string): void {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }
  const type = record["type"];
  if (
    type === "extension_ui_request" &&
    dialogs.has(String(record["method"]))
  ) {
    member.launcher.stdin?.write(
      `${JSON.stringify({ type: "extension_ui_response", id: record["id"], cancelled: true })}\n`
    );
    return;
  }
  const kind = member.role.kind;
  const busy = kind === "working" || kind === "killed";
  if (
    (busy &&
      type === "tool_execution_start" &&
      record["toolName"] === "bash") ||
    (!busy && type === "agent_settled")
  ) {
    member.ready = true;
  }
}

async function until(
  done: () => boolean,
  timeoutMs: number,
  what: string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${timeoutMs / 1000}s waiting for ${what}`
      );
    }
    await sleep(100);
  }
}

/** Every member recorded by its launcher and in its state. */
async function allReady(
  repoRoot: string,
  members: readonly Member[],
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const records = await readSessions(repoRoot).catch(() => []);
    for (const m of members) {
      const record = records.find((r) => r.launcherPid === m.launcherPid);
      if (record !== undefined && m.session === null) {
        m.session = record.session;
        m.piSessionId = record.piSessionId;
        m.pid = record.pid;
      }
      if (m.exited && !m.ready) {
        throw new Error(
          `${m.role.name}'s Pi exited before it was ready: ${m.stderr.trim().split("\n").slice(-5).join(" / ") || "(no output)"}`
        );
      }
    }
    if (members.every((m) => m.ready && m.session !== null)) {
      return;
    }
    if (Date.now() > deadline) {
      const late = members.filter((m) => !m.ready || m.session === null);
      throw new Error(
        `timed out after ${timeoutMs / 1000}s: ${late.map((m) => m.role.name).join(", ")} not ready`
      );
    }
    await sleep(100);
  }
}

/** SIGTERM each Pi (its launcher records the end), then clear what's left. */
async function stopMembers(members: readonly Member[]): Promise<void> {
  const table = processTable();
  const below = new Map<Member, number[]>();
  for (const m of members) {
    below.set(m, descendants(m.launcherPid, table));
    if (!m.exited) {
      kill(m.pid ?? m.launcherPid, "SIGTERM");
    }
  }
  await until(() => members.every((m) => m.exited), 10_000, "").catch(
    () => undefined
  );
  for (const m of members) {
    if (!m.exited) {
      kill(m.launcherPid, "SIGKILL");
    }
    for (const pid of below.get(m) ?? []) {
      kill(pid, "SIGKILL");
    }
  }
}

// --- Starting and stopping it from a command --------------------------------

/**
 * Starts a host for a new run and returns the run's ID at once. The host
 * writes `env.json`; use `waitForEnv` to see it ready.
 */
export function spawnHost(ctx: ExerciseContext, lifetimeMs: number): string {
  const run = `run_${Date.now().toString(36)}`;
  mkdirSync(ctx.stateDir, { recursive: true });
  const log = openSync(logPath(ctx.stateDir), "a");
  try {
    spawn(
      process.execPath,
      [hostPath, "middle", ctx.repoRoot, ctx.stateDir, run, String(lifetimeMs)],
      { detached: true, stdio: ["ignore", log, log], env: process.env }
    ).unref();
  } finally {
    closeSync(log);
  }
  return run;
}

/** Waits until run `run` reaches one of `statuses`; returns its state. */
export async function waitForEnv(
  stateDir: string,
  run: string,
  statuses: readonly EnvStatus[],
  timeoutMs: number
): Promise<EnvState> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const env = await readEnv(stateDir);
    if (env !== null && env.run === run) {
      if (statuses.includes(env.status)) {
        return env;
      }
      if (env.status === "failed" || !pidAlive(env.hostPid)) {
        return env;
      }
    }
    if (Date.now() > deadline) {
      throw new Error(
        `the environment's sessions weren't ready after ${timeoutMs / 1000}s (log: ${logPath(stateDir)})`
      );
    }
    await sleep(200);
  }
}

/** Stops the running set, if any, and waits for it. */
export async function stopEnv(stateDir: string): Promise<EnvState | null> {
  const env = await readEnv(stateDir);
  if (env === null || !isLive(env)) {
    return env;
  }
  kill(env.hostPid, "SIGTERM");
  const deadline = Date.now() + 30_000;
  while (pidAlive(env.hostPid) && Date.now() < deadline) {
    await sleep(200);
  }
  return readEnv(stateDir);
}

// node shared/several-agents/environment.ts middle|host <repoRoot> <stateDir> <run> <lifetimeMs>
if (process.argv[1] === hostPath) {
  const [mode, repoRoot = "", stateDir = "", run = "", lifetime = "0"] =
    process.argv.slice(2);
  if (mode === "middle") {
    // Start the host and leave at once, so the host has no parent left.
    spawn(
      process.execPath,
      [hostPath, "host", repoRoot, stateDir, run, lifetime],
      { detached: true, stdio: "inherit", env: process.env }
    ).unref();
    process.exit(0);
  } else if (mode === "host") {
    await runHost(repoRoot, stateDir, run, Number(lifetime));
  }
}
