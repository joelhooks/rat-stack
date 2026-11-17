import { spawn } from "node:child_process";
import { constants, realpathSync } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import { Schema } from "effect";

import type { Env, ExerciseContext } from "./context.ts";
import { gitEnv } from "./git-env.ts";
import { guestRootEnv } from "./guest-root.ts";
import { tryReadJson, writeJsonAtomic } from "./store.ts";

// Every step's done check ends with this line: the guest's work for the step
// is committed in the guest's own repo, through their own commit hook.
//
// "The work for this step" is:
//   - nothing is left uncommitted, outside the starter's own folder (when the
//     starter sits inside the guest's repo) and `.workshop-state/`;
//   - HEAD's tree passes the guest's hooks (below).
// A HEAD older than the step's start (the exercise's first `setup`; a later
// `setup` keeps that time) still passes, with a note: a guest may build a
// step's work before its setup, and then has nothing new to commit. The
// step's other lines catch a guest who did nothing.
//
// "Through their hook": git keeps no record of whether hooks ran for a
// commit, so `-n` leaves no trace. Instead, with nothing uncommitted, the
// guest's commit hooks run once more on the tree as it stands, which is
// HEAD's tree, in the guest's own folder, as `git commit` would run them.
// A commit whose tree their hook refuses doesn't count, however it got in.
// A hook that only looks at staged files has nothing staged here and passes.
// Nothing is committed, staged or written in the guest's repo. A pass is
// remembered for that HEAD, so a second `done` doesn't run the hook again.

export const commitClaimName =
  "this step's work is committed, through your commit hook";

/** What `done` prints for the commit line. */
export const commitSays = {
  [commitClaimName]: {
    yes: "This step's work is committed, through your commit hook.",
    no: "This step's work isn't committed through your commit hook yet.",
  },
};

/** The commit line's fix when all it lacks is a commit. */
export const commitFix = "commit this step's work, then run this again.";

/** The commit hook events, the ones that can refuse a commit. */
const commitHookEvents = [
  "pre-commit",
  "prepare-commit-msg",
  "commit-msg",
] as const;

/** Set while the hooks run, so a hook that runs `done` doesn't run them again. */
export const hookRunEnv = "TMX_COMMIT_HOOK_RUN";

const StepStart = Schema.Struct({ at: Schema.String });
const HookPass = Schema.Struct({ head: Schema.String, at: Schema.String });

export const stepStartPath = (ctx: Pick<ExerciseContext, "stateDir">) =>
  join(ctx.stateDir, "step-start.json");
const hookPassPath = (ctx: Pick<ExerciseContext, "stateDir">) =>
  join(ctx.stateDir, "commit-hook-pass.json");

/** Records when this step began. Only the first call counts. */
export async function markStepStart(
  ctx: Pick<ExerciseContext, "stateDir">,
  at: Date = new Date()
): Promise<void> {
  const read = await tryReadJson(stepStartPath(ctx), StepStart);
  if (!read.ok) {
    await writeJsonAtomic(stepStartPath(ctx), { at: at.toISOString() });
  }
}

export type CommitClaim = {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  /** Set when the one thing missing is a commit. */
  readonly fix?: string;
  /** What `done` prints for this case, when it's more than the name says. */
  readonly says?: string;
};

export type CommitContext = Pick<
  ExerciseContext,
  "exerciseId" | "repoRoot" | "guestRoot" | "stateDir"
>;

type Run = { readonly code: number | null; readonly output: string };

function run(
  cwd: string,
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 60_000
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

/** The last lines of `text` on one line, for a claim's detail. */
const tail = (text: string, lines = 3) =>
  text
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(-lines)
    .join(" | ");

const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

const ex = (ctx: CommitContext, command: string) =>
  `pnpm ex ${ctx.exerciseId} ${command}`;

/** At most `max` paths, then a count. */
const listed = (paths: readonly string[], max = 5) =>
  paths.length <= max
    ? paths.join(", ")
    : `${paths.slice(0, max).join(", ")} and ${paths.length - max} more`;

/**
 * Uncommitted paths in the guest's repo, leaving out the starter's folder
 * when it sits inside, and the starter's state.
 */
async function uncommitted(
  ctx: CommitContext,
  env: NodeJS.ProcessEnv
): Promise<string[] | Run> {
  const starter = relative(real(ctx.guestRoot), real(ctx.repoRoot));
  const outside = starter.startsWith("..") || isAbsolute(starter);
  const skip =
    starter === ""
      ? [":(exclude,top).workshop-state"]
      : outside
        ? []
        : [`:(exclude,top)${starter}`];
  const status = await run(
    ctx.guestRoot,
    "git",
    [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ":(top)",
      ...skip,
    ],
    env
  );
  if (status.code !== 0) {
    return status;
  }
  const entries = status.output.split("\0").filter((s) => s !== "");
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? "";
    paths.push(entry.slice(3));
    // A rename or copy is followed by the path it came from.
    if (/^[RC]/.test(entry)) {
      i++;
    }
  }
  return paths;
}

/**
 * The commit hook events git would run here: `git hook list` where git has
 * it (2.54 and later, which also runs hooks set in config), otherwise the
 * executable hook file git would run.
 */
async function commitHooks(
  top: string,
  env: NodeJS.ProcessEnv
): Promise<{ event: string; file: string | null }[]> {
  const found: { event: string; file: string | null }[] = [];
  for (const event of commitHookEvents) {
    const fromGit = await run(top, "git", ["hook", "list", event], env);
    if (fromGit.code === 0) {
      found.push({ event, file: null });
      continue;
    }
    const path = await run(
      top,
      "git",
      ["rev-parse", "--git-path", `hooks/${event}`],
      env
    );
    const file = resolve(top, path.output.trim());
    try {
      await access(file, constants.X_OK);
      found.push({ event, file });
    } catch {
      // Not there, or not executable: git skips it too.
    }
  }
  return found;
}

type HookOutcome =
  | { readonly ok: true; readonly events: readonly string[]; ms: number }
  | { readonly ok: false; readonly event: string; readonly output: string };

/** Runs the guest's commit hooks on the tree as it stands, as `git commit` would. */
async function runCommitHooks(
  top: string,
  env: NodeJS.ProcessEnv,
  hooks: readonly { event: string; file: string | null }[]
): Promise<HookOutcome> {
  const message = (await run(top, "git", ["log", "-1", "--format=%B"], env))
    .output;
  const index = (
    await run(top, "git", ["rev-parse", "--git-path", "index"], env)
  ).output.trim();
  // What `git commit` hands its hooks; a hook manager stays on.
  const hookEnv: NodeJS.ProcessEnv = {
    ...env,
    GIT_INDEX_FILE: index,
    GIT_EDITOR: ":",
    [hookRunEnv]: "1",
  };
  delete hookEnv["LEFTHOOK"];
  delete hookEnv["HUSKY"];
  const scratch = await mkdtemp(join(tmpdir(), "tmx-commit-line-"));
  const msgFile = join(scratch, "COMMIT_EDITMSG");
  const started = performance.now();
  try {
    await writeFile(msgFile, message);
    for (const { event, file } of hooks) {
      const args =
        event === "pre-commit"
          ? []
          : event === "prepare-commit-msg"
            ? [msgFile, "message"]
            : [msgFile];
      const result =
        file === null
          ? await run(
              top,
              "git",
              ["hook", "run", event, "--", ...args],
              hookEnv,
              600_000
            )
          : await run(top, file, args, hookEnv, 600_000);
      if (result.code !== 0) {
        return { ok: false, event, output: tail(result.output) };
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return {
    ok: true,
    events: hooks.map((h) => h.event),
    ms: Math.round(performance.now() - started),
  };
}

/** The line every exercise's `done` ends with, for the guest's repo. */
export function commitLine(
  ctx: ExerciseContext,
  opts: { readonly env?: Env } = {}
): Promise<CommitClaim> {
  // TMX_GUEST_ROOT moves into exerciseContext with the rest of packet 1;
  // until then it's read here.
  const named = (opts.env ?? process.env)[guestRootEnv];
  return commitClaim(
    named === undefined || named === "" ? ctx : { ...ctx, guestRoot: named },
    opts
  );
}

/** `a`, `a and b`, `a, b and c`. */
const hookNames = (events: readonly string[]) =>
  events.length <= 1
    ? events.join("")
    : `${events.slice(0, -1).join(", ")} and ${events.at(-1) ?? ""}`;

/** The commit line. See the header. */
export async function commitClaim(
  ctx: CommitContext,
  opts: { readonly env?: Env } = {}
): Promise<CommitClaim> {
  const env = gitEnv(opts.env ?? process.env);
  const fail = (detail: string, says?: string): CommitClaim => ({
    name: commitClaimName,
    ok: false,
    detail,
    ...(says === undefined ? {} : { says }),
  });
  const start = await tryReadJson(stepStartPath(ctx), StepStart);
  if (!start.ok) {
    return {
      ...fail(
        `Run ${ex(ctx, "setup")} first: this step starts there.`,
        "This step hasn't been set up yet."
      ),
      fix: `run ${ex(ctx, "setup")}, then run this again.`,
    };
  }
  const head = await run(
    ctx.guestRoot,
    "git",
    ["log", "-1", "--format=%H%x00%ct%x00%s"],
    env
  );
  const [sha = "", ct = "", subject = ""] = head.output.trim().split("\0");
  if (head.code !== 0 || sha === "") {
    return fail(
      `${ctx.guestRoot} has no commit yet: is it a git repository? (${tail(head.output, 1)})`,
      "Your repo has no commit yet."
    );
  }
  const short = sha.slice(0, 7);
  const early =
    Number(ct) < Math.floor(Date.parse(start.value.at) / 1000)
      ? ` Note: your last commit is from before this step's setup (${start.value.at}); if this step added work, it's in it.`
      : "";
  const pass = (detail: string): CommitClaim => ({
    name: commitClaimName,
    ok: true,
    detail: `${detail}${early}`,
  });
  const dirty = await uncommitted(ctx, env);
  if (!Array.isArray(dirty)) {
    return fail(`git status failed: ${tail(dirty.output, 1)}`);
  }
  if (dirty.length > 0) {
    return {
      ...fail(
        `Not committed yet: ${listed(dirty)}.`,
        "This step's work isn't committed yet."
      ),
      fix: commitFix,
    };
  }
  const committed = `${short} "${subject}" is committed${early === "" ? " after this step's setup" : ""}, with nothing left over`;
  if (env[hookRunEnv] !== undefined) {
    return pass(
      `${committed}. (Run from inside your hook, so the hook isn't run again.)`
    );
  }
  const hooks = await commitHooks(ctx.guestRoot, env);
  if (hooks.length === 0) {
    return pass(
      `${committed}. git runs no commit hook in this repo, so there was none to go through.`
    );
  }
  const cached = await tryReadJson(hookPassPath(ctx), HookPass);
  if (cached.ok && cached.value.head === sha) {
    return pass(
      `${committed}, and your commit hook passed it (checked ${cached.value.at}).`
    );
  }
  const outcome = await runCommitHooks(ctx.guestRoot, env, hooks);
  if (!outcome.ok) {
    return fail(
      `${short} "${subject}" is committed, but your ${outcome.event} hook refuses it as it stands, so it didn't get in through that hook (git commit -n, or a hook changed since?). The hook said: ${outcome.output}`,
      "This step's last commit is one your commit hook refuses as it stands."
    );
  }
  await writeJsonAtomic(hookPassPath(ctx), {
    head: sha,
    at: new Date().toISOString(),
  });
  return pass(
    `${committed}, and your ${hookNames(outcome.events)} ${outcome.events.length === 1 ? "hook passes" : "hooks pass"} it (${(outcome.ms / 1000).toFixed(1)}s).`
  );
}
