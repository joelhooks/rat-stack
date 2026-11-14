import { spawn } from "node:child_process";
import { constants, existsSync, realpathSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { findRepoRoot } from "#shared/core/repo-root.ts";

import { piCliPath } from "../../scripts/lib/pi.ts";
import { probeProviderPath, startFakeModel } from "./probe.ts";

// Can an agent working in this repo skip its commit hook? Asked of the fence's
// throwaway copy (./fence.ts), with the type-broken probe files staged. For
// each way of skipping a hook, a fresh Pi starts in the copy as the guest's
// Pi would (their own Pi setup, and the repo's `.pi` trusted for this one
// run), against a fake model that makes one bash tool call with that commit
// and then stops. Held when no commit was made: git or its hook refused it,
// or the guest's Pi refused the tool call. Nothing here knows how the guest
// built either; it only looks at whether HEAD moved.

/** The commits an agent tries when a hook is in its way. */
export const skipCommands = [
  'git commit -n -m "test: fence check"',
  'LEFTHOOK=0 git commit -m "test: fence check"',
  'git -c core.hooksPath=/dev/null commit -m "test: fence check"',
] as const;

export type SkipTry = {
  readonly command: string;
  readonly refused: boolean;
  /**
   * Who refused: `git` when the command ran and failed, `pi` when the
   * guest's Pi stopped the tool call (or the run) first. Null when it went
   * through.
   */
  readonly by: "git" | "pi" | null;
  /** The last lines of the tool result the model got back. */
  readonly output: string;
};

export type SkipReport =
  | { readonly ok: true; readonly tries: readonly SkipTry[] }
  | { readonly ok: false; readonly reason: string };

/** The throwaway copy, as the fence leaves it after its broken commit. */
export type SkipCopy = {
  /** The copy: a `git clone --local` of the guest's repo, at `base`. */
  readonly wt: string;
  /** The guest's repo root, for the Pi packages its `.pi` installed. */
  readonly top: string;
  /** The commit the copy is at. */
  readonly base: string;
  /** The type-broken probe files, relative to the copy, to stage. */
  readonly files: readonly string[];
  /** git's env, from the fence: no GIT_*, LEFTHOOK or HUSKY of the caller's. */
  readonly env: NodeJS.ProcessEnv;
};

export type SkipRunner = (copy: SkipCopy) => Promise<SkipReport>;

export type SkipOptions = {
  /** The starter whose pinned Pi runs. Defaults to this checkout. */
  readonly starterRoot?: string;
  /** Per Pi run. */
  readonly timeoutMs?: number;
};

type Run = { readonly code: number | null; readonly output: string };

function run(
  cwd: string,
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<Run> {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });
    let output = "";
    child.stdout.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr.on("data", (d: Buffer) => (output += d.toString()));
    child.on("error", (error) =>
      resolveRun({ code: null, output: `${output}\n${error.message}` })
    );
    child.on("close", (code, signal) =>
      resolveRun({
        code,
        output: signal === null ? output : `${output}\n(stopped: ${signal})`,
      })
    );
  });
}

const tail = (text: string, lines = 3) =>
  text
    .trim()
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(-lines)
    .join("\n");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toolNames = (body: unknown): string[] =>
  isRecord(body) && Array.isArray(body["tools"])
    ? body["tools"].flatMap((tool: unknown) => {
        const fn = isRecord(tool) ? tool["function"] : undefined;
        const name = isRecord(fn) ? fn["name"] : undefined;
        return typeof name === "string" ? [name] : [];
      })
    : [];

/** The text of the last tool result in a request, or null when there is none. */
export function lastToolResult(body: unknown): string | null {
  const messages =
    isRecord(body) && Array.isArray(body["messages"]) ? body["messages"] : [];
  const last = messages.findLast(
    (m: unknown) => isRecord(m) && m["role"] === "tool"
  );
  if (!isRecord(last)) {
    return null;
  }
  const content = last["content"];
  return typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((part: unknown) =>
            isRecord(part) && typeof part["text"] === "string"
              ? part["text"]
              : ""
          )
          .join("\n")
      : "";
}

/** Pi's bash tool ends a failed command's output with its exit code. */
const ranAndFailed = /exited with code [1-9]\d*/i;

/**
 * Pi packages the guest's `.pi/settings.json` installed: git-ignored, so the
 * copy lacks them, and Pi would fetch them again. Copied, never linked.
 */
async function copyPiPackages(top: string, wt: string): Promise<void> {
  for (const dir of ["git", "npm"]) {
    const from = join(top, ".pi", dir);
    const to = join(wt, ".pi", dir);
    if (existsSync(from) && !existsSync(to)) {
      await cp(from, to, {
        recursive: true,
        verbatimSymlinks: true,
        mode: constants.COPYFILE_FICLONE,
      });
    }
  }
}

/** The probe files a Pi that failed to start tried to load as extensions. */
export function probeFilesPiLoaded(
  output: string,
  wt: string,
  files: readonly string[]
): string[] {
  const failed = [
    ...output.matchAll(/Failed to load extension "([^"]+)"/g),
  ].map((match) => match[1] ?? "");
  // Pi may name the copy by its real path (a temp folder can be a symlink).
  let roots = [wt];
  try {
    roots = [wt, realpathSync(wt)];
  } catch {
    // A copy that's gone has no real path; its own name is enough.
  }
  return files.filter((file) =>
    failed.some((path) => roots.some((root) => path === join(root, file)))
  );
}

/** The identity and signing a commit in the copy uses, whatever the guest's git config says. */
const commitEnv: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: "tokenmaxx done check",
  GIT_AUTHOR_EMAIL: "done-check@localhost",
  GIT_COMMITTER_NAME: "tokenmaxx done check",
  GIT_COMMITTER_EMAIL: "done-check@localhost",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_VALUE_0: "false",
};

/** Tries every skip command in the copy, each in a fresh Pi. See the header. */
export async function trySkips(
  copy: SkipCopy,
  opts: SkipOptions = {}
): Promise<SkipReport> {
  const starterRoot = opts.starterRoot ?? findRepoRoot();
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const git = (args: readonly string[], env: NodeJS.ProcessEnv = {}) =>
    run(copy.wt, "git", args, { ...copy.env, ...env }, timeoutMs);
  const backToBase = async () => {
    await git(["reset", "-q", "--soft", copy.base]);
    await git(["reset", "-q"]);
  };
  await copyPiPackages(copy.top, copy.wt);
  let files = [...copy.files];
  // A probe file in a folder Pi loads extensions from (`.pi/extensions/`, a
  // package's `extensions/`) stops a fresh Pi from starting. Those come out,
  // found the way Pi reports them; the one at the root stays.
  const drop = async (gone: readonly string[]) => {
    for (const file of gone) {
      await rm(join(copy.wt, file), { force: true });
    }
    files = files.filter((file) => !gone.includes(file));
  };
  await drop(files.filter((file) => file.split(/[\\/]/).includes(".pi")));
  const tries: SkipTry[] = [];
  for (const command of skipCommands) {
    let attempt: Attempt | null = null;
    for (let round = 0; attempt === null && round < 5; round += 1) {
      await git(["add", "-f", "--", ...files]);
      const ran = await tryOne(
        copy.wt,
        starterRoot,
        command,
        {
          ...copy.env,
          ...commitEnv,
        },
        timeoutMs
      );
      const loaded =
        ran.kind === "no-start"
          ? probeFilesPiLoaded(ran.output, copy.wt, files)
          : [];
      if (loaded.length > 0) {
        await git(["reset", "-q"]);
        await drop(loaded);
      } else {
        attempt = ran;
      }
    }
    if (attempt === null || attempt.kind === "no-start") {
      return {
        ok: false,
        reason: `a fresh Pi in the copy exited ${attempt?.code ?? "on a signal"} before asking the model anything: ${tail(attempt?.output ?? "", 4) || "(no output)"}`,
      };
    }
    if (attempt.kind === "no-bash") {
      return {
        ok: false,
        reason: "a fresh Pi in your repo has no bash tool to try it with.",
      };
    }
    const head = await git(["rev-parse", "HEAD"]);
    const went = head.code === 0 && head.output.trim() !== copy.base;
    // Back to the base commit with the probe files untouched.
    await backToBase();
    tries.push({
      command,
      refused: !went,
      by: went
        ? null
        : attempt.result !== null && ranAndFailed.test(attempt.result)
          ? "git"
          : "pi",
      output: tail(attempt.result ?? `(Pi stopped the run) ${attempt.output}`),
    });
  }
  if (files.length < copy.files.length) {
    // Fewer probe files than the fence used: the hook still has to refuse a
    // plain commit of these, or a skip that "got through" proves nothing.
    await git(["add", "-f", "--", ...files]);
    const plain = await git(
      ["commit", "-q", "-m", "test: fence check"],
      commitEnv
    );
    const head = await git(["rev-parse", "HEAD"]);
    await backToBase();
    if (plain.code === 0 || head.output.trim() !== copy.base) {
      return {
        ok: false,
        reason: `your hook only caught the type error in folders Pi loads extensions from (${copy.files
          .filter((file) => !files.includes(file))
          .map((file) => dirname(file))
          .join(", ")}), and a fresh Pi can't start with it there.`,
      };
    }
  }
  return { ok: true, tries };
}

type Attempt =
  | {
      readonly kind: "no-start";
      readonly code: number | null;
      readonly output: string;
    }
  | { readonly kind: "no-bash" }
  | {
      readonly kind: "ran";
      /** The tool result the model got back, or null when Pi stopped the run. */
      readonly result: string | null;
      readonly output: string;
    };

/** One fresh Pi in the copy whose model makes one bash call with `command`. */
async function tryOne(
  wt: string,
  starterRoot: string,
  command: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<Attempt> {
  let hasBash = true;
  const server = await startFakeModel((body, index) => {
    if (index === 0) {
      hasBash = toolNames(body).includes("bash");
      return hasBash
        ? { tool: "bash", args: { command } }
        : { text: "No bash tool here." };
    }
    return { text: "Done." };
  });
  let pi: Run;
  try {
    pi = await run(
      wt,
      process.execPath,
      [
        piCliPath(starterRoot),
        "--no-session",
        "--approve",
        "-e",
        probeProviderPath,
        "--model",
        "probe/probe",
        "-p",
        "Commit the staged change.",
      ],
      { ...env, TMX_PROBE_URL: server.url, PI_SKIP_VERSION_CHECK: "1" },
      timeoutMs
    );
  } finally {
    await server.close();
  }
  const [first, second] = server.requests;
  if (first === undefined) {
    return { kind: "no-start", code: pi.code, output: pi.output };
  }
  if (!hasBash) {
    return { kind: "no-bash" };
  }
  return {
    kind: "ran",
    result: second === undefined ? null : lastToolResult(second),
    output: pi.output,
  };
}
