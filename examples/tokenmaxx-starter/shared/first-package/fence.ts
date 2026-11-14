import { spawn } from "node:child_process";
import { constants, existsSync, lstatSync, realpathSync } from "node:fs";
import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import { type SkipReport, type SkipRunner, trySkips } from "./skip.ts";

// Does this repo refuse a type-broken commit? Asked of a throwaway copy, never
// the repo itself. `git clone --local` makes the copy, and the repo's own
// config, `info/` and hooks are copied into it, so whatever fence the guest
// built (a git hook, `core.hooksPath`, hooks set in config, lefthook, husky,
// anything `git commit` runs) runs there too. The copy gets the guest's
// uncommitted and untracked files, so a fence that isn't committed yet still
// counts, and installed dependencies of its own, so the fence's tools run.
//
// Nothing in the copy links back into the guest's repo, so nothing the hook
// runs there can write into it. It is a repository of its own, so git hands
// the hook no GIT_DIR, and a test the hook runs that drives git without
// scrubbing git's env (`git init` and `git commit` in a fixture, `git config`
// where it stands) writes into the copy or its own fixture, never the guest's
// objects, refs, config or index. (A linked worktree shared all four.) The
// copy's objects are hard links where the disk allows: git never rewrites an
// object file, it only adds new ones. Where they can't be (a temp folder on
// another disk), git copies them. A pnpm repo gets `pnpm install --offline
// --frozen-lockfile` in the copy, from the store the guest's own install came
// from: workspace packages link to the copy's packages, not the guest's, and
// pnpm's check that deps match the workspace passes. Any other installed
// node_modules is copied (cloned where the disk can). An install that fails
// is reported as such, with no fallback; a symlink would let pnpm install
// through it into the guest's node_modules. The install runs against a
// throwaway git dir, so a `prepare` script or a hook manager's postinstall
// can't rewrite the guest's hooks or git config.
//
// Then two commits, each adding the same small file at the root and in
// every folder of the guest's own TypeScript (not the starter's shared/,
// scripts/ or exercises/, which the starter's own typecheck already covers):
//
//   control: `export const tmxFenceCheck = (value: number): number => value;`
//            must go through
//   broken:  `export const tmxFenceCheck = (value: number): string => value;`
//            must be refused
//
// The two differ only in the type error, so a refusal of `broken` alone is a
// refusal for the type error, not for formatting, a commit message rule or a
// fence that refuses everything. Neither has a comment, both are what oxfmt
// and prettier print, and both pass strict lint sets such as ultracite's. A
// repo whose own TypeScript is written without semicolons gets them without
// the trailing `;`, as its formatter would print them.
//
// Then the stretch, only when `broken` was refused: can an agent skip the
// hook? A fresh Pi in the copy tries `broken` again with `git commit -n`,
// `LEFTHOOK=0` and `core.hooksPath` (./skip.ts). The copy is removed either
// way, so the repo is left as it was found. The check compares a snapshot
// from before and after to prove it.

export type CommitTry = {
  readonly refused: boolean;
  /** The last lines git and the hooks printed. */
  readonly output: string;
  /** How long `git commit` took, hooks included. */
  readonly ms?: number;
};

export type FenceReport =
  | { readonly _tag: "NotARepo"; readonly detail: string }
  /** The nearest git repository is a folder above this one, not this one. */
  | { readonly _tag: "InsideAnotherRepo"; readonly top: string }
  | { readonly _tag: "NoCommit" }
  /** The throwaway copy couldn't get the repo's dependencies installed. */
  | {
      readonly _tag: "NoDeps";
      readonly command: string;
      /** The last lines the install printed. */
      readonly output: string;
    }
  | {
      readonly _tag: "Tried";
      /** How many directories got a probe file. */
      readonly places: number;
      readonly control: CommitTry;
      readonly broken: CommitTry;
      /**
       * An agent trying to skip the hook on `broken`. Null when `broken` went
       * through, or when the run was told not to try.
       */
      readonly skips: SkipReport | null;
      /** The starter's own folders, which got no probe file. */
      readonly supplied?: readonly string[];
      /** The commit hook events git runs for this repo, e.g. `pre-commit`. */
      readonly hooks?: readonly string[];
      /** What changed in the repo, if anything did. Should always be null. */
      readonly changed: string | null;
    };

export const probeFile = "tmx-fence-check.ts";

const probe = (returns: string, semi: boolean) =>
  `export const tmxFenceCheck = (value: number): ${returns} => value${semi ? ";" : ""}\n`;
export const wellTyped = probe("number", true);
export const typeBroken = probe("string", true);

/**
 * Semicolons or not, by the guest's own TypeScript: most files with a line
 * ending in `;` means yes. No TypeScript of theirs means yes, the default.
 */
export function writesSemicolons(sources: readonly string[]): boolean {
  let semi = 0;
  let none = 0;
  for (const text of sources) {
    if (/;\s*$/m.test(text)) {
      semi += 1;
    } else if (text.trim() !== "") {
      none += 1;
    }
  }
  return semi >= none;
}

/** The commit hook events, the ones that can refuse a commit. */
export const commitHookEvents = [
  "pre-commit",
  "prepare-commit-msg",
  "commit-msg",
] as const;

type Run = { readonly code: number | null; readonly output: string };

/** Env for git and its hooks: the caller's, minus anything that redirects git or switches a hook manager off. */
export function fenceEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("GIT_") || key === "LEFTHOOK" || key === "HUSKY") {
      continue;
    }
    clean[key] = value;
  }
  return { ...clean, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" };
}

function run(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 180_000,
  command = "git"
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

async function git(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv
): Promise<string> {
  const result = await run(cwd, args, env);
  if (result.code !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${result.code}): ${result.output.trim()}`
    );
  }
  return result.output;
}

const nulList = (text: string) => text.split("\0").filter((s) => s !== "");

const tail = (text: string, lines = 6) =>
  text
    .trim()
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(-lines)
    .join("\n");

/** Everything about the repo a check could disturb, as one comparable string. */
async function snapshot(top: string, env: NodeJS.ProcessEnv): Promise<string> {
  const parts = await Promise.all([
    run(top, ["rev-parse", "HEAD"], env),
    run(top, ["symbolic-ref", "-q", "HEAD"], env),
    run(top, ["for-each-ref", "--format=%(refname) %(objectname)"], env),
    run(top, ["worktree", "list", "--porcelain"], env),
    run(top, ["stash", "list"], env),
    run(top, ["config", "--local", "--list"], env),
    run(top, ["count-objects"], env),
    run(top, ["status", "--porcelain=v1", "--untracked-files=all"], env),
  ]);
  return parts.map((p) => p.output).join("\n--\n");
}

function describeChange(before: string, after: string): string {
  const a = new Set(before.split("\n"));
  const b = new Set(after.split("\n"));
  const gone = [...a].filter((line) => !b.has(line)).map((l) => `- ${l}`);
  const added = [...b].filter((line) => !a.has(line)).map((l) => `+ ${l}`);
  return [...gone, ...added].slice(0, 10).join("\n");
}

/** `path` relative to `dir` when it's inside it, else null. */
function inside(dir: string, path: string): string | null {
  const rel = relative(dir, path);
  return rel === ".." || rel.startsWith("../") || isAbsolute(rel) ? null : rel;
}

const copyTree = (from: string, to: string, force: boolean) =>
  cp(from, to, {
    recursive: true,
    force,
    errorOnExist: false,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
  });

/** The repo's git dir and common git dir, absolute. */
async function gitDirs(
  top: string,
  env: NodeJS.ProcessEnv
): Promise<{ gitDir: string; common: string }> {
  const [gitDir = "", common = ""] = (
    await git(top, ["rev-parse", "--git-dir", "--git-common-dir"], env)
  )
    .trim()
    .split("\n");
  return { gitDir: resolve(top, gitDir), common: resolve(top, common) };
}

/**
 * Clones the repo into `wt` at `base`, with the repo's own config (and its
 * worktree config), `info/` (excludes, attributes, a hook manager's records)
 * and hooks folder in place of the clone's. Checked out with hooks off: the
 * guest's commit hooks are the ones under test, not their post-checkout.
 */
async function makeCopy(
  top: string,
  wt: string,
  base: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const { gitDir, common } = await gitDirs(top, env);
  // A clone from a path is a local clone (`--local`) already. Spelled out,
  // `--local` fails when the temp folder is on another disk, where hard
  // links can't reach; left implied, git copies the objects instead.
  await git(
    dirname(wt),
    ["clone", "--quiet", "--no-checkout", "--", top, wt],
    env
  );
  const copyGit = join(wt, ".git");
  await copyFile(join(common, "config"), join(copyGit, "config"));
  if (existsSync(join(gitDir, "config.worktree"))) {
    await copyFile(
      join(gitDir, "config.worktree"),
      join(copyGit, "config.worktree")
    );
  }
  // A work tree named in the repo's config is the guest's own folder.
  await run(wt, ["config", "--local", "--unset-all", "core.worktree"], env);
  for (const dir of ["info", "hooks"]) {
    await rm(join(copyGit, dir), { recursive: true, force: true });
    if (existsSync(join(common, dir))) {
      await copyTree(join(common, dir), join(copyGit, dir), true);
    }
  }
  await git(
    wt,
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "advice.detachedHead=false",
      "checkout",
      "-q",
      "-f",
      "--detach",
      base,
    ],
    env
  );
}

/**
 * Makes the copy's git find the hooks the repo's git finds. A `core.hooksPath`
 * in the repo or its git dir names the copy's own folder, with any files git
 * ignores there (husky's `.husky/_`) copied over; one outside both stays as
 * it is. Hooks set in config that the copy's git doesn't see (an `includeIf`
 * on the repo's path, in the guest's global config) are set in the copy.
 */
async function carryHooks(
  top: string,
  wt: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const pathOf = async (cwd: string) => {
    const got = await run(
      cwd,
      ["config", "--type=path", "--get", "core.hooksPath"],
      env
    );
    return got.code === 0 ? got.output.trim() : "";
  };
  const value = await pathOf(top);
  if (value !== "") {
    const { common } = await gitDirs(top, env);
    const from = resolve(top, value);
    const inGit = inside(common, from);
    const inTop = inGit === null ? inside(top, from) : null;
    const target =
      inGit !== null
        ? join(wt, ".git", inGit)
        : inTop !== null
          ? join(wt, inTop)
          : from;
    if (target !== from && existsSync(from)) {
      await copyTree(from, target, false);
    }
    const want =
      !isAbsolute(value) && resolve(wt, value) === target ? value : target;
    if ((await pathOf(wt)) !== want) {
      await git(wt, ["config", "--local", "core.hooksPath", want], env);
    }
  }
  const configured = async (cwd: string) => {
    const got = await run(
      cwd,
      ["config", "-z", "--get-regexp", "^hook\\."],
      env
    );
    return got.code === 0 ? nulList(got.output) : [];
  };
  const seen = new Set(await configured(wt));
  for (const entry of await configured(top)) {
    if (!seen.has(entry)) {
      const [key = "", ...rest] = entry.split("\n");
      await git(wt, ["config", "--local", "--add", key, rest.join("\n")], env);
    }
  }
}

/** Copies the guest's uncommitted and untracked files into the copy. */
async function copyWorkingState(
  top: string,
  wt: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const changed = nulList(
    await git(top, ["ls-files", "-z", "-m", "-o", "--exclude-standard"], env)
  );
  for (const path of new Set(changed)) {
    const from = join(top, path);
    const to = join(wt, path);
    if (!existsSync(from) && !isSymlink(from)) {
      await rm(to, { force: true });
      continue;
    }
    await mkdir(dirname(to), { recursive: true });
    await rm(to, { force: true, recursive: true });
    if (isSymlink(from)) {
      await symlink(await readlink(from), to);
    } else if (lstatSync(from).isFile()) {
      await copyFile(from, to);
    }
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Every ignored node_modules folder in the guest's tree, relative to it. */
async function installedDirs(
  top: string,
  env: NodeJS.ProcessEnv
): Promise<string[]> {
  const ignored = nulList(
    await git(
      top,
      ["ls-files", "-z", "-o", "-i", "--exclude-standard", "--directory"],
      env
    )
  );
  return ignored
    .map((entry) => entry.replace(/\/$/, ""))
    .filter((path) => basename(path) === "node_modules");
}

/** The pnpm store the guest's install came from, as its node_modules records it. */
async function pnpmStoreDir(top: string): Promise<string | null> {
  try {
    const text = await readFile(
      join(top, "node_modules", ".modules.yaml"),
      "utf8"
    );
    return (
      /^\s*"?storeDir"?\s*:\s*"?([^"\n]+?)"?,?\s*$/m.exec(text)?.[1] ?? null
    );
  } catch {
    return null;
  }
}

type DepsResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly command: string; readonly output: string };

/**
 * Gives the copy installed dependencies of its own, never a link into the
 * guest's. Only when the guest has installed some: a repo with no
 * node_modules gets none in the copy either.
 */
async function installDeps(
  top: string,
  wt: string,
  scratch: string,
  env: NodeJS.ProcessEnv
): Promise<DepsResult> {
  const dirs = await installedDirs(top, env);
  if (dirs.length === 0) {
    return { ok: true };
  }
  if (existsSync(join(wt, "pnpm-lock.yaml")) && dirs.includes("node_modules")) {
    const store = await pnpmStoreDir(top);
    const args = [
      "install",
      "--offline",
      "--frozen-lockfile",
      ...(store === null ? [] : ["--store-dir", store]),
    ];
    // Any git command the install runs (a `prepare` that sets
    // core.hooksPath, lefthook's postinstall) lands in a throwaway repo.
    const gitDir = join(scratch, "install.git");
    await git(scratch, ["init", "-q", "--bare", gitDir], env);
    const result = await run(
      wt,
      args,
      { ...env, GIT_DIR: gitDir, GIT_WORK_TREE: wt },
      300_000,
      "pnpm"
    );
    return result.code === 0
      ? { ok: true }
      : {
          ok: false,
          command: `pnpm install --offline --frozen-lockfile`,
          output: tail(result.output, 4),
        };
  }
  // npm, yarn, bun or a hand-made node_modules: a copy. Links inside it stay
  // as written, so a relative one resolves inside the copy.
  for (const dir of dirs) {
    const to = join(wt, dir);
    if (existsSync(to)) {
      continue;
    }
    await mkdir(dirname(to), { recursive: true });
    await cp(join(top, dir), to, {
      recursive: true,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
    });
  }
  return { ok: true };
}

/**
 * The starter's own folders. Its `pnpm typecheck` covers them, so a probe file
 * there would pass a fence that never looks at the guest's code.
 */
export const suppliedFolders = ["shared", "scripts", "exercises"] as const;

const isSupplied = (dir: string, supplied: readonly string[]) =>
  supplied.some((top) => dir === top || dir.startsWith(`${top}/`));

/**
 * Every folder of the guest's own that holds a TypeScript file, plus the
 * root, and those files.
 */
async function placesFor(
  wt: string,
  env: NodeJS.ProcessEnv,
  supplied: readonly string[]
): Promise<{ places: string[]; own: string[] }> {
  const files = nulList(
    await git(
      wt,
      [
        "ls-files",
        "-z",
        "-c",
        "-o",
        "--exclude-standard",
        "--",
        "*.ts",
        "*.mts",
        "*.cts",
        "*.tsx",
      ],
      env
    )
  );
  const dirs = new Set(["."]);
  const own: string[] = [];
  for (const file of files) {
    const dir = dirname(file);
    if (basename(file) !== probeFile && !isSupplied(dir, supplied)) {
      dirs.add(dir);
      own.push(file);
    }
  }
  return { places: [...dirs].toSorted(), own };
}

/** Whether the guest's TypeScript ends statements with `;`. Reads at most 200 files. */
async function semicolonStyle(wt: string, own: readonly string[]) {
  const sources = await Promise.all(
    own
      .slice(0, 200)
      .map((file) => readFile(join(wt, file), "utf8").catch(() => ""))
  );
  return writesSemicolons(sources);
}

/**
 * The commit hook events git would run here. `git hook list` asks git itself
 * (hooks dir, core.hooksPath, hooks set in config), and only a git that has
 * it exits 0. Any other answer gets the file git would run, if it's
 * executable: git 2.36 to 2.53 has `git hook` without `list` (exit 129), an
 * older git has no `git hook` at all (exit 1, the same code a newer git gives
 * for "no hooks"), and neither runs hooks set in config. On a git that has
 * the list, no listed hook means no file either, so asking again agrees.
 */
async function commitHooks(
  wt: string,
  env: NodeJS.ProcessEnv
): Promise<string[]> {
  const found: string[] = [];
  for (const event of commitHookEvents) {
    const listed = await run(wt, ["hook", "list", event], env);
    if (listed.code === 0) {
      found.push(event);
      continue;
    }
    const path = await run(
      wt,
      ["rev-parse", "--git-path", `hooks/${event}`],
      env
    );
    try {
      await access(resolve(wt, path.output.trim()), constants.X_OK);
      found.push(event);
    } catch {
      // Not there, or not executable: git skips it too.
    }
  }
  return found;
}

export type FenceOptions = {
  readonly env?: NodeJS.ProcessEnv;
  /** Folders that get no probe file. Defaults to `suppliedFolders`. */
  readonly supplied?: readonly string[];
  /** The agent stretch. Defaults to `trySkips`; null skips it. */
  readonly skip?: SkipRunner | null;
};

/** Runs the fence test against the repo at `repoRoot`. See the header. */
export async function tryFence(
  repoRoot: string,
  opts: FenceOptions = {}
): Promise<FenceReport> {
  const env = fenceEnv(opts.env ?? process.env);
  const topRun = await run(repoRoot, ["rev-parse", "--show-toplevel"], env);
  if (topRun.code !== 0) {
    return { _tag: "NotARepo", detail: tail(topRun.output, 1) };
  }
  const top = topRun.output.trim();
  // Never test, or copy, a repository this folder merely sits in.
  if (realpathSync(top) !== realpathSync(repoRoot)) {
    return { _tag: "InsideAnotherRepo", top };
  }
  const head = await run(top, ["rev-parse", "--verify", "-q", "HEAD"], env);
  if (head.code !== 0) {
    return { _tag: "NoCommit" };
  }
  const base = head.output.trim();
  const before = await snapshot(top, env);

  const scratch = await mkdtemp(join(tmpdir(), "tmx-fence-"));
  const wt = join(scratch, "repo");
  try {
    await makeCopy(top, wt, base, env);
    await copyWorkingState(top, wt, env);
    await carryHooks(top, wt, env);
    const deps = await installDeps(top, wt, scratch, env);
    if (!deps.ok) {
      return { _tag: "NoDeps", command: deps.command, output: deps.output };
    }
    const supplied = opts.supplied ?? suppliedFolders;
    const { places, own } = await placesFor(wt, env, supplied);
    const files = places.map((dir) => join(dir, probeFile));
    const semi = await semicolonStyle(wt, own);
    const hooks = await commitHooks(wt, env);

    const attempt = async (content: string): Promise<CommitTry> => {
      for (const file of files) {
        await writeFile(join(wt, file), content);
      }
      await git(wt, ["add", "-f", "--", ...files], env);
      const started = performance.now();
      const result = await run(
        wt,
        [
          "-c",
          "user.name=tokenmaxx done check",
          "-c",
          "user.email=done-check@localhost",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "-m",
          "test: fence check",
        ],
        env
      );
      const ms = Math.round(performance.now() - started);
      // Back to the base commit with the working files untouched, so the
      // next attempt starts from the same place.
      await git(wt, ["reset", "-q", "--soft", base], env);
      await git(wt, ["reset", "-q"], env);
      return { refused: result.code !== 0, output: tail(result.output), ms };
    };

    const fine = probe("number", semi);
    const wrong = probe("string", semi);
    const control = await attempt(fine);
    const broken = await attempt(wrong);
    const skip = opts.skip === undefined ? trySkips : opts.skip;
    const skips =
      broken.refused && skip !== null
        ? await skip({ wt, top, base, files, env })
        : null;
    await rm(scratch, { recursive: true, force: true });
    const after = await snapshot(top, env);
    return {
      _tag: "Tried",
      places: places.length,
      control,
      broken,
      skips,
      supplied,
      hooks,
      changed: before === after ? null : describeChange(before, after),
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
