import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { exerciseContext } from "#shared/core/context.ts";
import { now } from "#shared/core/paths.ts";
import {
  endOf,
  isTopLevel,
  newSessionId,
  readSessions,
  type SessionRecord,
  sessionEnv,
  sessionFromEnv,
  writeSession,
} from "#shared/core/sessions.ts";
import { fold, readEvents } from "#shared/own-loop/job.ts";

import { type Ancestry, findLiveAncestor, systemAncestry } from "./ancestry.ts";
import { discoverExercises } from "./exercises.ts";

const piPackage = join("node_modules", "@earendil-works", "pi-coding-agent");

/**
 * Loaded into every Pi with `-e` (which `-ne` keeps): notes who prompted it,
 * for checks that need "nobody asked". See shared/core/turns.ts.
 */
export function observerPath(repoRoot: string): string {
  return join(repoRoot, "shared", "core", "turns-observer.ts");
}

/** The pinned Pi's CLI entry, run with this Node. Not the global `pi`. */
export function piCliPath(repoRoot: string): string {
  const pkg: { bin?: { pi?: string } } = JSON.parse(
    readFileSync(join(repoRoot, piPackage, "package.json"), "utf8")
  );
  if (pkg.bin?.pi === undefined) {
    throw new Error(`${piPackage}/package.json has no bin.pi`);
  }
  return join(repoRoot, piPackage, pkg.bin.pi);
}

/**
 * The PID of the guest's top-level `pnpm pi` launcher, exported to Pi and
 * everything it runs. Pi itself is that process's child.
 */
export const guestPidEnv = "TMX_GUEST_PI_PID";

/** The role when none is given. A role only names a stable Pi session. */
export const defaultRole = "main";

export type LaunchArgs = {
  readonly role: string;
  readonly exercise: string | undefined;
  /** Start a new session instead of resuming this role's stable one. */
  readonly fresh: boolean;
  /** Everything else, passed to Pi as given. */
  readonly piArgs: readonly string[];
};

/**
 * Takes `--role <name>`, `--exercise <id>` and `--fresh` out of argv,
 * anywhere before a bare `--`. The rest goes to Pi untouched. The bare `--`
 * itself is dropped: Pi would read it as end-of-options and treat every flag
 * after it (`-ne`, `-ns`, `-p`) as prompt text.
 */
export function parseLaunchArgs(argv: readonly string[]): LaunchArgs {
  let role = defaultRole;
  let exercise: string | undefined;
  let fresh = false;
  const piArgs: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (token === "--") {
      piArgs.push(...argv.slice(i + 1));
      break;
    }
    const [flag, inline] = splitFlag(token);
    if (flag === "--fresh") {
      fresh = true;
    } else if (flag === "--role" || flag === "--exercise") {
      const value = inline ?? argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`${flag} needs a value`);
      }
      if (inline === undefined) {
        i += 1;
      }
      if (flag === "--role") {
        role = value;
      } else {
        exercise = value;
      }
    } else {
      piArgs.push(token);
    }
  }
  if (!/^[a-z][a-z0-9-]*$/.test(role)) {
    throw new Error(
      `--role must be lowercase letters, digits and dashes; got ${role}`
    );
  }
  return { role, exercise, fresh, piArgs };
}

function splitFlag(token: string): [string, string | undefined] {
  const eq = token.indexOf("=");
  return token.startsWith("--") && eq > 0
    ? [token.slice(0, eq), token.slice(eq + 1)]
    : [token, undefined];
}

const sessionFlags = new Set([
  "--session",
  "--session-id",
  "--continue",
  "-c",
  "--resume",
  "-r",
  "--fork",
  "--no-session",
]);

/** Pi's stable session per exercise and role, so relaunching resumes it. */
export function sessionIdFor(who: {
  role: string;
  exercise: string | undefined;
}): string {
  return who.exercise === undefined
    ? `tmx-${who.role}`
    : `tmx-${who.exercise}-${who.role}`;
}

/**
 * Pi's argv. Adds `--session-id <stable id>` unless the caller already chose a
 * session with a session flag. Returns the session ID in use, or null when the
 * caller's flags pick one we cannot know (`--continue`, `--resume`, ...).
 */
export function buildPiArgs(
  piArgs: readonly string[],
  defaultSessionId: string
): { args: string[]; sessionId: string | null } {
  const userFlag = piArgs.findIndex((arg) =>
    sessionFlags.has(splitFlag(arg)[0])
  );
  if (userFlag === -1) {
    return {
      args: ["--session-id", defaultSessionId, ...piArgs],
      sessionId: defaultSessionId,
    };
  }
  const [flag, inline] = splitFlag(piArgs[userFlag] ?? "");
  const sessionId =
    flag === "--session-id" ? (inline ?? piArgs[userFlag + 1] ?? null) : null;
  return { args: [...piArgs], sessionId };
}

/**
 * The stable ID plus a UTC timestamp and a random tail, so `--fresh` never
 * resumes anything and two launches in the same millisecond still differ.
 */
export function freshSessionId(
  stable: string,
  at = new Date(),
  tail = randomTail()
): string {
  return `${stable}-${at.toISOString().replace(/[-:.]/g, "")}-${tail}`;
}

function randomTail(): string {
  return Math.random().toString(16).slice(2, 8).padEnd(6, "0");
}

/** The exercise whose wait has to outlive a quit. */
export const survivesQuit = "02.2";

/**
 * The Pi conversation that started 02.2's open run (the current one, not yet
 * consumed), when no running Pi has it open: the one a relaunch should
 * resume, even if it was started with `--fresh`. Only a top-level session of
 * this role counts. Null when there's nothing waiting.
 */
export async function waitingConversation(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  role: string,
  records: readonly SessionRecord[],
  alive: (pid: number) => boolean
): Promise<string | null> {
  const { stateDir } = exerciseContext({
    exerciseId: survivesQuit,
    repoRoot,
    env,
  });
  const { current, consumed } = fold(
    await readEvents(stateDir).catch(() => [])
  );
  if (
    current === null ||
    current.session === null ||
    consumed.some((c) => c.runId === current.runId)
  ) {
    return null;
  }
  const starter = records.find((r) => r.session === current.session);
  const id = starter?.piSessionId ?? null;
  if (
    starter === undefined ||
    id === null ||
    !isTopLevel(starter) ||
    starter.role !== role ||
    starter.exercise !== survivesQuit
  ) {
    return null;
  }
  const open = records.some(
    (r) => r.piSessionId === id && r.ended === null && alive(r.pid)
  );
  return open ? null : id;
}

export type Launch = {
  readonly cli: string;
  readonly args: readonly string[];
  /** Pi's environment, TMX_SESSION included. */
  readonly env: NodeJS.ProcessEnv;
  /** The session record; `pid` and `startedAt` are filled in at spawn. */
  readonly record: SessionRecord;
  /**
   * The Pi session ID the launcher picked, which it creates quietly before
   * Pi starts if it doesn't exist yet. Null when the caller's own session
   * flags picked the session.
   */
  readonly ownSessionId: string | null;
  /** One line for the person at the terminal before Pi starts, or null. */
  readonly notice: string | null;
};

/**
 * Resolves everything `pnpm pi` needs without starting anything. `ancestry`
 * is this process's tree; tests pass their own.
 */
export async function planLaunch(
  argv: readonly string[],
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  ancestry: Ancestry = systemAncestry
): Promise<Launch> {
  const parsed = parseLaunchArgs(argv);
  if (parsed.exercise !== undefined) {
    const entries = await discoverExercises(join(repoRoot, "exercises"));
    if (!entries.some((e) => e.id === parsed.exercise)) {
      throw new Error(
        `Unknown exercise: ${parsed.exercise}. Valid ids: ${entries.map((e) => e.id).join(", ")}`
      );
    }
  }
  if (
    parsed.fresh &&
    parsed.piArgs.some((arg) => sessionFlags.has(splitFlag(arg)[0]))
  ) {
    throw new Error("--fresh picks its own session; drop the session flag");
  }
  const callerPicked = parsed.piArgs.some((arg) =>
    sessionFlags.has(splitFlag(arg)[0])
  );
  // Nested when a running recorded Pi is among our ancestors, whatever the
  // env says; otherwise when TMX_SESSION is set. If the tree can't be read,
  // the env rule alone decides.
  const records = await readSessions(repoRoot);
  const chain = ancestry.ancestors();
  const live =
    chain === null ? null : findLiveAncestor(chain, records, ancestry.alive);
  const envParent = sessionFromEnv(env);
  const parentSession = live?.parent.session ?? envParent;
  // A guest who started 02.2's run in a `--fresh` conversation and quit gets
  // that conversation back from the plain relaunch the readme gives, so the
  // wait isn't stranded in a session nobody reopens.
  const waiting =
    parsed.exercise === survivesQuit &&
    !parsed.fresh &&
    !callerPicked &&
    parentSession === null
      ? await waitingConversation(
          repoRoot,
          env,
          parsed.role,
          records,
          ancestry.alive
        )
      : null;
  const stable = waiting ?? sessionIdFor(parsed);
  // A running Pi that already has the stable conversation open. A process
  // whose parent exited is reparented to PID 1, so the tree can miss a Pi
  // started from inside the guest's; this still keeps it out of the guest's
  // conversation.
  const holder = records.find(
    (r) => r.piSessionId === stable && r.ended === null && ancestry.alive(r.pid)
  );
  // A Pi started from inside another Pi (an agent testing its own work, say)
  // gets a new conversation: resuming the stable one would open the parent's
  // conversation while the parent still has it open, and both would write to
  // one file.
  const fresh = parsed.fresh || parentSession !== null || holder !== undefined;
  const { args, sessionId } = buildPiArgs(
    parsed.piArgs,
    fresh ? freshSessionId(stable) : stable
  );
  const session = newSessionId();
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    TMX_ROLE: parsed.role,
    [sessionEnv]: session,
    // The guest's own Pi: this launcher, with Pi as its child. A nested Pi
    // keeps its parent's value, so an agent cleaning up its test Pis can tell
    // them from the session it's running in.
    [guestPidEnv]:
      live !== null
        ? String(live.guestPid)
        : parentSession === null
          ? String(process.pid)
          : (env[guestPidEnv] ?? String(process.pid)),
  };
  if (parsed.exercise !== undefined) {
    childEnv["TMX_EXERCISE"] = parsed.exercise;
  }
  return {
    cli: piCliPath(repoRoot),
    args: ["-e", observerPath(repoRoot), ...args],
    env: childEnv,
    notice:
      holder !== undefined && parentSession === null && !callerPicked
        ? `${stable} is already open in another Pi (pid ${holder.pid}), so this one starts a new conversation.`
        : waiting !== null && waiting !== sessionIdFor(parsed)
          ? `Resuming ${waiting}: the conversation that started the open ${survivesQuit} run.`
          : null,
    ownSessionId: callerPicked ? null : sessionId,
    record: {
      session,
      parentSession,
      piSessionId: sessionId,
      pid: 0,
      launcherPid: process.pid,
      role: parsed.role,
      exercise: parsed.exercise ?? null,
      startedAt: now(),
      endedAt: null,
      ended: null,
      exitCode: null,
      exitSignal: null,
    },
  };
}

/**
 * Starts the pinned Pi in the repo root with the terminal attached, writes the
 * session's start record, and resolves with Pi's exit code once it exits,
 * after writing the end record. SIGTERM or SIGHUP sent to this wrapper is
 * passed on to Pi, and the end record says `signal` even when Pi then shuts
 * down cleanly with exit code 0: it was stopped, it didn't quit.
 */
export async function launchPi(
  launch: Launch,
  repoRoot: string
): Promise<number> {
  if (launch.ownSessionId !== null) {
    await createPiSessionQuietly(
      repoRoot,
      launch.ownSessionId,
      launch.env,
      launch.args
    );
  }
  const child = spawn(process.execPath, [launch.cli, ...launch.args], {
    cwd: repoRoot,
    env: launch.env,
    stdio: "inherit",
  });
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolveExit, rejectExit) => {
    child.on("exit", (code, signal) => resolveExit({ code, signal }));
    child.on("error", rejectExit);
  });
  if (child.pid === undefined) {
    await exited;
    return 1;
  }
  const record: SessionRecord = {
    ...launch.record,
    pid: child.pid,
    startedAt: now(),
  };
  // Listen before writing the start record: the record is readable once it's
  // renamed into place, before the write resolves, and a SIGTERM in that gap
  // would otherwise stop this wrapper and leave Pi running.
  let forwarded: NodeJS.Signals | null = null;
  const forward = (signal: NodeJS.Signals) => () => {
    forwarded ??= signal;
    child.kill(signal);
  };
  const onTerm = forward("SIGTERM");
  const onHup = forward("SIGHUP");
  const ignoreInt = () => undefined;
  process.on("SIGTERM", onTerm);
  process.on("SIGHUP", onHup);
  // Ctrl+C belongs to Pi's TUI; the wrapper waits for Pi instead of dying first.
  process.on("SIGINT", ignoreInt);
  try {
    await writeSession(repoRoot, record);
    const { code, signal } = await exited;
    const stoppedBy = signal ?? forwarded;
    await writeSession(repoRoot, {
      ...record,
      endedAt: now(),
      ended: endOf({ code, signal: stoppedBy }),
      exitCode: code,
      exitSignal: stoppedBy,
    });
    return code ?? (signal === null ? 1 : 128 + signalNumber(signal));
  } finally {
    process.off("SIGTERM", onTerm);
    process.off("SIGHUP", onHup);
    process.off("SIGINT", ignoreInt);
  }
}

function signalNumber(signal: NodeJS.Signals): number {
  const numbers: Partial<Record<NodeJS.Signals, number>> = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGKILL: 9,
    SIGTERM: 15,
  };
  return numbers[signal] ?? 0;
}

const expandHome = (path: string) =>
  path === "~"
    ? homedir()
    : path.startsWith("~/")
      ? join(homedir(), path.slice(2))
      : path;

/**
 * Where Pi keeps this project's sessions, worked out the way Pi does it:
 * `--session-dir`, then PI_CODING_AGENT_SESSION_DIR, then `sessionDir` in
 * Pi's settings, then `<agent dir>/sessions/--<cwd>--`.
 */
export async function piSessionDir(
  cwd: string,
  env: NodeJS.ProcessEnv,
  args: readonly string[] = []
): Promise<string> {
  const flag = args.findIndex((arg) => splitFlag(arg)[0] === "--session-dir");
  const fromFlag =
    flag === -1
      ? undefined
      : (splitFlag(args[flag] ?? "")[1] ?? args[flag + 1]);
  const fromEnv = env["PI_CODING_AGENT_SESSION_DIR"];
  const agentDir = expandHome(
    env["PI_CODING_AGENT_DIR"] || join(homedir(), ".pi", "agent")
  );
  const chosen =
    fromFlag ??
    (fromEnv === undefined || fromEnv === "" ? undefined : fromEnv) ??
    (await import("@earendil-works/pi-coding-agent")).SettingsManager.create(
      cwd,
      agentDir
    ).getSessionDir();
  return chosen === undefined || chosen === ""
    ? join(
        agentDir,
        "sessions",
        `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`
      )
    : resolve(cwd, expandHome(chosen));
}

/**
 * Gives Pi's session `id` a file holding only its header, when Pi has no
 * session with that ID yet. Pi then opens it like any other session instead
 * of printing "No project session found with id ...; creating a new session
 * with that id." as the first line a guest reads. Pi's other warnings are
 * untouched. Best effort: on any failure Pi creates the session itself, with
 * its warning. Returns the file it wrote, or null.
 */
export async function createPiSessionQuietly(
  repoRoot: string,
  id: string,
  env: NodeJS.ProcessEnv,
  args: readonly string[] = []
): Promise<string | null> {
  try {
    const { SessionManager, CURRENT_SESSION_VERSION } =
      await import("@earendil-works/pi-coding-agent");
    // Pi runs with the repo as its cwd and records the resolved path.
    const cwd = realpathSync(repoRoot);
    const dir = await piSessionDir(cwd, env, args);
    if (SessionManager.findById(cwd, id, dir) !== undefined) {
      return null;
    }
    const timestamp = new Date().toISOString();
    const file = join(dir, `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`);
    mkdirSync(dir, { recursive: true });
    const header = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id,
      timestamp,
      cwd,
    };
    writeFileSync(file, `${JSON.stringify(header)}\n`, { flag: "wx" });
    return file;
  } catch {
    return null;
  }
}
