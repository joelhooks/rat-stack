import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { type Env, exerciseContext } from "#shared/core/context.ts";
import type { Exercise } from "#shared/core/exercise.ts";
import {
  readSessions,
  type SessionRecord,
  sessionEnv,
  sessionFromEnv,
} from "#shared/core/sessions.ts";
import { exists } from "#shared/core/store.ts";

/**
 * The workshop facts from the environment, for the top of `status`: the
 * session, whether it's nested, and the guest's Pi. None of them is a secret,
 * so nobody needs to dump env to find them.
 */
export function workshopLine(
  env: Env,
  records: readonly SessionRecord[]
): string {
  const session = sessionFromEnv(env);
  if (session === null) {
    return `Workshop: no ${sessionEnv}, so this wasn't run from inside a \`pnpm pi\` session.`;
  }
  const record = records.find((r) => r.session === session);
  const nesting =
    record === undefined
      ? "no record of it"
      : record.parentSession === null
        ? "top-level"
        : `nested in ${record.parentSession}`;
  const rest = ["TMX_EXERCISE", "TMX_ROLE", "TMX_GUEST_PI_PID"]
    .filter((name) => (env[name] ?? "") !== "")
    .map((name) => `${name}=${env[name]}`);
  return `Workshop: ${[`${sessionEnv}=${session} (${nesting})`, ...rest].join(", ")}`;
}

/**
 * One `exercises/NN-problem/NN.M-name/` folder: the exercise's `exercise.ts`,
 * its readme, its done check and the check's tests. Supplied, all of it; a
 * guest's own code lives wherever they put it.
 */
export type ExerciseEntry = {
  readonly id: string;
  readonly slug: string;
  readonly section: string;
  readonly dir: string;
  /** False for a folder with only a readme so far. */
  readonly runnable: boolean;
};

const folderPattern = /^(\d+\.\d+)-(.+)$/;

async function subdirs(dir: string): Promise<string[]> {
  const dirents = await readdir(dir, { withFileTypes: true });
  return dirents
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .toSorted();
}

export async function discoverExercises(
  exercisesDir: string
): Promise<ExerciseEntry[]> {
  if (!(await exists(exercisesDir))) {
    return [];
  }
  const entries: ExerciseEntry[] = [];
  for (const section of await subdirs(exercisesDir)) {
    for (const folder of await subdirs(join(exercisesDir, section))) {
      const match = folderPattern.exec(folder);
      if (match?.[1] === undefined || match[2] === undefined) {
        continue;
      }
      const dir = join(exercisesDir, section, folder);
      const runnable = await exists(join(dir, "exercise.ts"));
      entries.push({ id: match[1], slug: match[2], section, dir, runnable });
    }
  }
  return entries;
}

export async function loadExercise(entry: ExerciseEntry): Promise<Exercise> {
  const file = join(entry.dir, "exercise.ts");
  if (!entry.runnable) {
    throw new Error(`${entry.id} has no exercise.ts yet`);
  }
  const mod: { default?: Exercise } = await import(pathToFileURL(file).href);
  if (mod.default === undefined) {
    throw new Error(
      `${file} must default-export defineExercise({ id, title, commands })`
    );
  }
  if (mod.default.id !== entry.id) {
    throw new Error(
      `${file} declares id ${mod.default.id}, but its folder says ${entry.id}`
    );
  }
  return mod.default;
}

export type ExArgs = {
  readonly id: string | undefined;
  readonly command: string | undefined;
  readonly args: readonly string[];
};

/**
 * `<id> <command> [...args]`. A bare `--` before the command is skipped;
 * everything after the command goes to it untouched.
 */
export function parseExArgs(argv: readonly string[]): ExArgs {
  const head: string[] = [];
  let i = 0;
  for (; i < argv.length && head.length < 2; i += 1) {
    const token = argv[i];
    if (token !== undefined && token !== "--") {
      head.push(token);
    }
  }
  return { id: head[0], command: head[1], args: argv.slice(i) };
}

export type Io = {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
};

export type TestRunner = (
  folder: string,
  env: NodeJS.ProcessEnv
) => Promise<number>;

export type RunOptions = {
  readonly repoRoot: string;
  readonly exercisesDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly io: Io;
  /** Runs vitest for `pnpm ex <id> test`. Swappable in tests. */
  readonly runTests?: TestRunner;
};

/** Commands the runner owns for every exercise. */
export const runnerCommands = ["test"] as const;

export async function runEx(
  argv: readonly string[],
  opts: RunOptions
): Promise<number> {
  const { io, repoRoot } = opts;
  const exercisesDir = opts.exercisesDir ?? join(repoRoot, "exercises");
  const entries = await discoverExercises(exercisesDir);
  const parsed = parseExArgs(argv);

  if (parsed.id === undefined) {
    await printList(entries, io);
    return 0;
  }
  const entry = entries.find((e) => e.id === parsed.id);
  if (entry === undefined) {
    io.err(`Unknown exercise: ${parsed.id}`);
    io.err(`Valid ids: ${entries.map((e) => e.id).join(", ") || "(none)"}`);
    io.err("Run `pnpm ex` to list exercises and their commands.");
    return 2;
  }
  if (!entry.runnable) {
    io.err(`${entry.id} has no exercise.ts yet: read its readme.md.`);
    return 2;
  }
  const exercise = await loadExercise(entry);
  const names = [...Object.keys(exercise.commands), ...runnerCommands];
  const commandName = parsed.command;
  if (commandName === undefined || !names.includes(commandName)) {
    io.err(
      commandName === undefined
        ? `No command given for ${entry.id}.`
        : `Unknown command for ${entry.id}: ${commandName}`
    );
    io.err(`Valid commands: ${names.join(", ")}`);
    return 2;
  }

  const env = { ...(opts.env ?? process.env) };
  if (commandName === "status") {
    io.out(workshopLine(env, await readSessions(repoRoot)));
  }
  env["TMX_EXERCISE"] = entry.id;
  if (commandName === "test") {
    const folder = relative(repoRoot, entry.dir);
    return (opts.runTests ?? runVitest(repoRoot))(folder, env);
  }
  const ctx = exerciseContext({ exerciseId: entry.id, repoRoot, env });
  const command = exercise.commands[commandName];
  if (command === undefined) {
    return 2;
  }
  // Child processes a command starts (Pi, vitest) see the same exercise.
  process.env["TMX_EXERCISE"] = entry.id;
  try {
    return await command(ctx, parsed.args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.err(`${entry.id} ${commandName} failed: ${message}`);
    return 1;
  }
}

async function printList(entries: readonly ExerciseEntry[], io: Io) {
  io.out("Usage: pnpm ex <id> <command> [...args]");
  io.out("");
  for (const entry of entries) {
    io.out(`${entry.id}  ${entry.slug}  ${await describeCommands(entry)}`);
  }
  if (entries.length === 0) {
    io.out("(no exercises yet)");
  }
}

async function describeCommands(entry: ExerciseEntry): Promise<string> {
  if (!entry.runnable) {
    return "(readme only)";
  }
  try {
    const exercise = await loadExercise(entry);
    return [...Object.keys(exercise.commands), ...runnerCommands].join(", ");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `(failed to load: ${message})`;
  }
}

function runVitest(repoRoot: string): TestRunner {
  return (folder, env) =>
    new Promise((resolveExit) => {
      const child = spawn(
        process.execPath,
        [
          join(repoRoot, "node_modules", "vitest", "vitest.mjs"),
          "run",
          "--config",
          "vitest.exercise.config.ts",
          "--maxWorkers=4",
          folder,
        ],
        { cwd: repoRoot, env, stdio: "inherit" }
      );
      child.on("exit", (code) => resolveExit(code ?? 1));
      child.on("error", () => resolveExit(1));
    });
}
