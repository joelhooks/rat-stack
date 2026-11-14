import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { findRepoRoot } from "#shared/core/context.ts";

import { fenceClaim, hookTime, stretchLine } from "./claims.ts";
import {
  type FenceReport,
  tryFence,
  typeBroken,
  wellTyped,
  writesSemicolons,
} from "./fence.ts";

// The fence test against real throwaway repos with real hooks. Each repo is a
// guest's repo in miniature: a tsconfig, one TypeScript file, an installed
// node_modules (a link to this starter's, so tsc is real), and whatever fence
// the story gives it.

// Each fence test makes a worktree, copies or installs node_modules and
// commits four times through a real hook. That takes 1-5 s on a quiet
// machine, but a git-only one went past vitest's 30 s default on a loaded
// one, and the pnpm installs took up to 2 minutes with the disk busy. A
// guest's laptop can be slower still. So every describe below that runs the
// fence gives its tests about 3-4 times the slowest run seen, and the
// suite's default stays as it is.
const fenceRuns = { timeout: 120_000 };
const installRuns = { timeout: 360_000 };

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "tmx-fence-test-")));
afterAll(
  () => rmSync(scratch, { recursive: true, force: true }),
  fenceRuns.timeout
);

const starter = findRepoRoot();
const tsc = realpathSync(
  join(starter, "node_modules", "typescript", "bin", "tsc")
);
// `pnpm test` exports its own verify-deps setting to everything it runs; drop
// it, so each fixture's pnpm-workspace.yaml decides, as in a guest's repo.
const env: NodeJS.ProcessEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(npm|pnpm)_config_verify_deps_before_run$/i.test(key)
    )
  ),
  GIT_CONFIG_GLOBAL: "/dev/null",
};

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env, encoding: "utf8" });

function guestRepo(name: string): string {
  const repo = join(scratch, name);
  mkdirSync(join(repo, "src"), { recursive: true });
  sh(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  writeFileSync(
    join(repo, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, types: [] },
      include: ["**/*.ts"],
    })
  );
  writeFileSync(join(repo, "src", "tool.ts"), "export const x = 1;\n");
  sh(repo, "add", ".");
  sh(
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "-m",
    "init"
  );
  // The guest's install: a real folder holding a canary and a link to tsc.
  mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(repo, "node_modules", "canary.txt"), "keep me\n");
  symlinkSync(tsc, join(repo, "node_modules", ".bin", "tsc"));
  return repo;
}

function hook(repo: string, body: string) {
  const path = join(repo, ".git", "hooks", "pre-commit");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

/** Everything the fence test must leave alone. */
function state(repo: string) {
  return [
    sh(repo, "rev-parse", "HEAD"),
    sh(repo, "branch", "-a"),
    sh(repo, "worktree", "list", "--porcelain"),
    sh(repo, "stash", "list"),
    sh(repo, "status", "--porcelain=v1", "--untracked-files=all"),
    readFileSync(join(repo, "node_modules", "canary.txt"), "utf8"),
  ].join("\n--\n");
}

const typecheckHook = "node_modules/.bin/tsc -p . || exit 1";

async function fenced(
  repo: string,
  runEnv: NodeJS.ProcessEnv = env
): Promise<FenceReport> {
  const before = state(repo);
  const report = await tryFence(repo, { env: runEnv });
  expect(state(repo)).toBe(before);
  expect(existsSync(join(repo, "tmx-fence-check.ts"))).toBe(false);
  expect(report).not.toMatchObject({ changed: expect.any(String) });
  return report;
}

describe("the 01.1 fence test", fenceRuns, () => {
  it("fails a repo with no fence: the broken commit goes through", async () => {
    const report = await fenced(guestRepo("none"));
    expect(report._tag === "Tried" && report.broken.refused).toBe(false);
    expect(fenceClaim(report).ok).toBe(false);
    expect(fenceClaim(report).detail).toContain("Went through");
  });

  it("fails a fake fence that says it checked and didn't", async () => {
    const repo = guestRepo("fake");
    hook(repo, 'echo "typecheck passed"');
    expect(fenceClaim(await fenced(repo)).ok).toBe(false);
  });

  it("fails a fence that refuses every commit", async () => {
    const repo = guestRepo("wall");
    hook(repo, 'echo "no commits today" >&2; exit 1');
    const claim = fenceClaim(await fenced(repo));
    expect(claim.ok).toBe(false);
    expect(claim.detail).toContain("can't tell broken from fine");
    expect(claim.detail).toContain("no commits today");
  });

  it("passes a hook that typechecks, and reports -n getting through", async () => {
    const repo = guestRepo("tsc");
    hook(repo, typecheckHook);
    const report = await fenced(repo);
    expect(fenceClaim(report).ok).toBe(true);
    expect(stretchLine(report)).toMatchObject({
      held: false,
      detail: expect.stringContaining("git commit -n: got through"),
    });
  });

  it("passes a fence that only covers a subfolder, by finding that folder", async () => {
    const repo = guestRepo("narrow");
    hook(
      repo,
      "node_modules/.bin/tsc --noEmit --strict --ignoreConfig src/*.ts || exit 1"
    );
    expect(fenceClaim(await fenced(repo)).ok).toBe(true);
  });

  it("fails a fence that only covers the starter's folders, not the guest's", async () => {
    // Like wiring the starter's own `pnpm typecheck` into a hook: it covers
    // shared/, while the guest's code in src/ goes unchecked.
    const repo = guestRepo("starter-only");
    mkdirSync(join(repo, "shared"));
    writeFileSync(join(repo, "shared", "core.ts"), "export const y = 1;\n");
    sh(repo, "add", "shared");
    sh(
      repo,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "-m",
      "shared"
    );
    hook(
      repo,
      "node_modules/.bin/tsc --noEmit --strict --ignoreConfig shared/*.ts || exit 1"
    );
    const report = await fenced(repo);
    expect(fenceClaim(report).ok).toBe(false);
    expect(report).toMatchObject({ places: 2 });
  });

  it("counts a fence the guest hasn't committed yet, and leaves their changes alone", async () => {
    const repo = guestRepo("wip");
    writeFileSync(join(repo, "fence.sh"), `#!/bin/sh\n${typecheckHook}\n`);
    chmodSync(join(repo, "fence.sh"), 0o755);
    writeFileSync(join(repo, "src", "tool.ts"), "export const x = 2;\n");
    hook(repo, "[ -x ./fence.sh ] && exec ./fence.sh; exit 0");
    expect(fenceClaim(await fenced(repo)).ok).toBe(true);
    expect(readFileSync(join(repo, "src", "tool.ts"), "utf8")).toBe(
      "export const x = 2;\n"
    );
  });

  it("reports LEFTHOOK=0 as a stretch line, never as a FAIL", async () => {
    const repo = guestRepo("lefthook");
    hook(repo, `[ "$LEFTHOOK" = "0" ] && exit 0\n${typecheckHook}`);
    const report = await fenced(repo);
    expect(fenceClaim(report).ok).toBe(true);
    expect(stretchLine(report)?.detail).toContain(
      "LEFTHOOK=0 git commit: got through"
    );
  });

  it("isn't fooled by LEFTHOOK=0 or GIT_DIR in the caller's own env", async () => {
    const repo = guestRepo("callerenv");
    hook(repo, `[ "$LEFTHOOK" = "0" ] && exit 0\n${typecheckHook}`);
    const report = await tryFence(repo, {
      env: { ...env, LEFTHOOK: "0", GIT_DIR: "/nowhere" },
    });
    expect(fenceClaim(report).ok).toBe(true);
  });

  it("says so when there's no repository of its own, or no commit", async () => {
    const plain = join(scratch, "plain");
    mkdirSync(plain);
    expect((await tryFence(plain, { env }))._tag).toBe("NotARepo");
    const nested = join(scratch, "tsc", "nested");
    mkdirSync(nested);
    expect(await tryFence(nested, { env })).toMatchObject({
      _tag: "InsideAnotherRepo",
    });
    const empty = join(scratch, "empty");
    mkdirSync(empty);
    sh(empty, "init", "-q");
    expect(fenceClaim(await tryFence(empty, { env })).detail).toContain(
      "no commit yet"
    );
  });
});

// pnpm workspaces, where a symlinked node_modules broke the check and the
// guest's repo: pnpm installed through the link, rewriting the guest's own
// links to point into the deleted worktree. Two packages, one depending on
// the other, and no package from a registry, so `pnpm install --offline`
// needs nothing in pnpm's store. tsc runs from this starter by full path.
//
// The pnpm is whatever `pnpm` is on PATH. To run these under other pnpm
// versions too, set TMX_FENCE_TEST_PNPM to folders that each hold a `pnpm`,
// joined like PATH; each folder gets its own run.

const pnpmDirs: ReadonlyArray<{
  readonly label: string;
  readonly dir: string | null;
  readonly n: number;
}> = [
  null,
  ...(process.env["TMX_FENCE_TEST_PNPM"] ?? "")
    .split(delimiter)
    .filter((dir) => dir !== ""),
].map((dir, n) => ({ label: dir ?? "PATH", dir, n }));

const pnpmAt = (dir: string | null): NodeJS.ProcessEnv =>
  dir === null ? env : { ...env, PATH: `${dir}${delimiter}${env["PATH"]}` };

type Verify = "install" | "error" | null;

function pnpmWorkspace(
  name: string,
  pnpmEnv: NodeJS.ProcessEnv,
  opts: { verify: Verify; rootScripts?: Record<string, string> }
): string {
  const repo = join(scratch, name);
  mkdirSync(repo, { recursive: true });
  sh(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  writeFileSync(
    join(repo, "pnpm-workspace.yaml"),
    `packages:\n  - "packages/*"\n${opts.verify === null ? "" : `verifyDepsBeforeRun: ${opts.verify}\n`}`
  );
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({
      name: "fx-root",
      private: true,
      scripts: { typecheck: "pnpm -r run typecheck", ...opts.rootScripts },
    })
  );
  const typecheck = `node ${tsc} -p .`;
  const pkg = (dir: string, json: object, source: string) => {
    mkdirSync(join(repo, "packages", dir, "src"), { recursive: true });
    writeFileSync(
      join(repo, "packages", dir, "package.json"),
      JSON.stringify(json)
    );
    writeFileSync(
      join(repo, "packages", dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: "nodenext",
          moduleResolution: "nodenext",
          types: [],
        },
        include: ["src/**/*.ts"],
      })
    );
    writeFileSync(join(repo, "packages", dir, "src", "index.ts"), source);
  };
  pkg(
    "core",
    {
      name: "@fx/core",
      version: "1.0.0",
      type: "module",
      exports: { ".": "./src/index.ts" },
      scripts: { typecheck },
    },
    "export const answer: number = 42;\n"
  );
  pkg(
    "app",
    {
      name: "@fx/app",
      version: "1.0.0",
      type: "module",
      dependencies: { "@fx/core": "workspace:*" },
      scripts: { typecheck },
    },
    'import { answer } from "@fx/core";\nexport const doubled: number = answer * 2;\n'
  );
  execFileSync("pnpm", ["install", "--offline"], {
    cwd: repo,
    env: pnpmEnv,
    stdio: "pipe",
  });
  sh(repo, "add", ".");
  sh(
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "-m",
    "init"
  );
  return repo;
}

/** Every entry under every node_modules in `repo`: links with targets, files with hashes. */
function installed(repo: string): string[] {
  const lines: string[] = [];
  const walk = (dir: string, inside: boolean) => {
    for (const name of readdirSync(dir).toSorted()) {
      if (name === ".git") {
        continue;
      }
      const path = join(dir, name);
      const here = inside || name === "node_modules";
      const stat = lstatSync(path);
      const rel = relative(repo, path);
      if (stat.isSymbolicLink()) {
        if (here) {
          lines.push(`link ${rel} -> ${readlinkSync(path)}`);
        }
      } else if (stat.isDirectory()) {
        if (here) {
          lines.push(`dir ${rel}`);
        }
        walk(path, here);
      } else if (here) {
        const hash = createHash("sha256")
          .update(readFileSync(path))
          .digest("hex");
        lines.push(`file ${rel} ${hash}`);
      }
    }
  };
  walk(repo, false);
  return lines;
}

const pnpmVersion = (pnpmEnv: NodeJS.ProcessEnv, cwd: string) =>
  execFileSync("pnpm", ["--version"], { cwd, env: pnpmEnv, encoding: "utf8" })
    .trim()
    .split("\n")
    .at(-1);

const untrackedGate =
  '[ -z "$(git status --porcelain --untracked-files=all | grep "^??")" ] || { echo "untracked files" >&2; exit 1; }';

describe.each(pnpmDirs)(
  "the 01.1 fence test on a pnpm workspace (pnpm from $label)",
  installRuns,
  ({ dir, n }) => {
    const pnpmEnv = pnpmAt(dir);
    const tag = (name: string) => `${name}-${n}`;

    it("passes a hook that typechecks across packages, and refuses the type error", async () => {
      const repo = pnpmWorkspace(tag("ws"), pnpmEnv, { verify: null });
      hook(repo, "pnpm -r run typecheck || exit 1");
      const report = await tryFence(repo, { env: pnpmEnv });
      expect(report).toMatchObject({
        _tag: "Tried",
        places: 3,
        control: { refused: false },
        broken: { refused: true },
        changed: null,
      });
      expect(fenceClaim(report).ok).toBe(true);
    });

    it("leaves the guest's node_modules byte for byte as it was, with pnpm set to install before running", async () => {
      // The condition that did the damage: verify-deps sees the worktree as a
      // changed workspace and installs.
      const repo = pnpmWorkspace(tag("damage"), pnpmEnv, { verify: "install" });
      hook(repo, "pnpm run typecheck || exit 1");
      const before = installed(repo);
      expect(before).toContain(
        "link packages/app/node_modules/@fx/core -> ../../../core"
      );
      const report = await tryFence(repo, { env: pnpmEnv });
      expect(installed(repo)).toEqual(before);
      expect(report).toMatchObject({
        control: { refused: false },
        broken: { refused: true },
      });
      console.log(
        `pnpm ${pnpmVersion(pnpmEnv, repo)}: ${before.length} entries under node_modules before the fence, ${installed(repo).length} after, identical`
      );
    });

    it("isn't refused by pnpm's own check when verifyDepsBeforeRun is error", async () => {
      const repo = pnpmWorkspace(tag("verify-error"), pnpmEnv, {
        verify: "error",
      });
      hook(repo, "pnpm run typecheck || exit 1");
      const report = await tryFence(repo, { env: pnpmEnv });
      expect(report).toMatchObject({ control: { refused: false } });
      expect(fenceClaim(report).ok).toBe(true);
    });

    it("isn't refused by a gate that refuses untracked files", async () => {
      // `node_modules/` in .gitignore matches a folder, not a symlink, so a
      // linked node_modules showed up as untracked.
      const repo = pnpmWorkspace(tag("untracked"), pnpmEnv, { verify: null });
      hook(repo, `${untrackedGate}\npnpm -r run typecheck || exit 1`);
      expect(fenceClaim(await tryFence(repo, { env: pnpmEnv })).ok).toBe(true);
    });

    it("keeps a prepare script's git writes out of the guest's repo", async () => {
      const repo = pnpmWorkspace(tag("prepare"), pnpmEnv, {
        verify: null,
        rootScripts: {
          prepare:
            'git config tmx.prepared yes && echo "exit 0" > "$(git rev-parse --git-path hooks)/post-checkout"',
        },
      });
      hook(repo, "pnpm -r run typecheck || exit 1");
      // The guest's own install ran it; undo that, so any write is the fence's.
      sh(repo, "config", "--unset", "tmx.prepared");
      rmSync(join(repo, ".git", "hooks", "post-checkout"));
      const hooks = readdirSync(join(repo, ".git", "hooks")).toSorted();
      const config = readFileSync(join(repo, ".git", "config"), "utf8");
      expect(fenceClaim(await tryFence(repo, { env: pnpmEnv })).ok).toBe(true);
      expect(readFileSync(join(repo, ".git", "config"), "utf8")).toBe(config);
      expect(config).not.toContain("prepared");
      expect(readdirSync(join(repo, ".git", "hooks")).toSorted()).toEqual(
        hooks
      );
    });

    it("says so when the offline install fails, and links nothing instead", async () => {
      const repo = pnpmWorkspace(tag("noinstall"), pnpmEnv, { verify: null });
      hook(repo, "pnpm -r run typecheck || exit 1");
      // A dependency the lockfile doesn't have, uncommitted: frozen install fails.
      const app = join(repo, "packages", "app", "package.json");
      const json = JSON.parse(readFileSync(app, "utf8"));
      json.dependencies["tmx-not-in-the-lockfile"] = "1.0.0";
      writeFileSync(app, JSON.stringify(json));
      const before = installed(repo);
      const report = await tryFence(repo, { env: pnpmEnv });
      expect(report).toMatchObject({ _tag: "NoDeps" });
      const claim = fenceClaim(report);
      expect(claim.ok).toBe(false);
      expect(claim.detail).toContain("Couldn't install your dependencies");
      expect(installed(repo)).toEqual(before);
    });
  }
);

describe("a copied node_modules (no pnpm lockfile)", fenceRuns, () => {
  it("isn't refused by a gate that refuses untracked files", async () => {
    const repo = guestRepo("copy-untracked");
    hook(repo, `${untrackedGate}\n${typecheckHook}`);
    expect(fenceClaim(await fenced(repo)).ok).toBe(true);
  });

  it("can't be written through: a hook that writes into node_modules leaves the guest's alone", async () => {
    const repo = guestRepo("copy-write");
    hook(
      repo,
      `echo changed > node_modules/canary.txt\necho new > node_modules/new.txt\n${typecheckHook}`
    );
    const before = installed(repo);
    expect(fenceClaim(await fenced(repo)).ok).toBe(true);
    expect(installed(repo)).toEqual(before);
  });
});

describe("the hook-time line", fenceRuns, () => {
  const tried = (ms: number): FenceReport => ({
    _tag: "Tried",
    places: 1,
    control: { refused: false, output: "ok", ms },
    broken: { refused: true, output: "error TS2322", ms },
    noVerify: { refused: false, output: "ok" },
    lefthookOff: { refused: true, output: "error TS2322" },
    changed: null,
  });

  it("reports the time, and warns past 30 s without failing", () => {
    expect(fenceClaim(tried(2400)).detail).toContain(
      "Hook time: 2.4 s for the commit without the error."
    );
    expect(fenceClaim(tried(2400)).detail).not.toContain("Warning");
    const slow = fenceClaim(tried(45_000));
    expect(slow.ok).toBe(true);
    expect(slow.detail).toContain("Hook time: 45.0 s");
    expect(slow.detail).toContain("Warning: that's over 30 s");
  });

  it("is left out when no time was measured", () => {
    expect(hookTime({ refused: false, output: "ok" })).toEqual([]);
  });

  it("comes from a real run", async () => {
    const repo = guestRepo("timed");
    hook(repo, typecheckHook);
    const report = await fenced(repo);
    expect(report).toMatchObject({ control: { ms: expect.any(Number) } });
    expect(fenceClaim(report).detail).toMatch(/Hook time: \d+\.\d s/);
  });
});

const configHooksRun = runsConfigHooks();

describe("no commit hook", fenceRuns, () => {
  it("says no hook was found, and gives no time", async () => {
    const report = await fenced(guestRepo("nohook"));
    expect(report).toMatchObject({ hooks: [] });
    const { detail } = fenceClaim(report);
    expect(detail).toContain("No commit hook found");
    expect(detail).not.toContain("Hook time");
  });

  it("counts a non-executable hook file as no hook, as git does", async () => {
    const repo = guestRepo("nonexec");
    hook(repo, typecheckHook);
    chmodSync(join(repo, ".git", "hooks", "pre-commit"), 0o644);
    expect(await fenced(repo)).toMatchObject({ hooks: [] });
  });

  it("finds hooks in core.hooksPath", async () => {
    const report = await fenced(hooksPathRepo("hookspath"));
    expect(report).toMatchObject({ hooks: ["commit-msg"] });
    expect(fenceClaim(report).detail).toMatch(/Hook time: \d+\.\d s/);
  });

  // Hooks set in config (git 2.54 and later) run only on a git that has them,
  // so the fence reports them only there.
  it.runIf(configHooksRun)(
    "finds hooks set in git config, on a git that runs them",
    async () => {
      const report = await fenced(configHookRepo("confighook"));
      expect(report).toMatchObject({ hooks: ["pre-commit"] });
      expect(fenceClaim(report).ok).toBe(true);
    }
  );

  it.skipIf(configHooksRun)(
    "finds no hook set in git config, on a git that doesn't run them",
    async () => {
      const report = await fenced(configHookRepo("confighook"));
      expect(report).toMatchObject({ hooks: [] });
      expect(fenceClaim(report).ok).toBe(false);
      expect(fenceClaim(report).detail).toContain("No commit hook found");
    }
  );
});

function configHookRepo(name: string): string {
  const repo = guestRepo(name);
  sh(repo, "config", "hook.typecheck.command", typecheckHook);
  sh(repo, "config", "hook.typecheck.event", "pre-commit");
  return repo;
}

function hooksPathRepo(name: string): string {
  const repo = guestRepo(name);
  mkdirSync(join(repo, ".githooks"));
  writeFileSync(join(repo, ".githooks", "commit-msg"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(repo, ".githooks", "commit-msg"), 0o755);
  sh(repo, "config", "core.hooksPath", ".githooks");
  return repo;
}

/** Whether this git runs a hook set in config: one that refuses every commit. */
function runsConfigHooks(): boolean {
  const repo = join(scratch, "probe-config-hooks");
  if (!existsSync(repo)) {
    mkdirSync(repo);
    sh(repo, "init", "-q");
    sh(repo, "config", "hook.refuse.command", "exit 1");
    sh(repo, "config", "hook.refuse.event", "pre-commit");
  }
  const commit = spawnSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "probe",
    ],
    { cwd: repo, env }
  );
  return commit.status !== 0;
}

// A git older than the one running the tests, in front of it on PATH. It
// answers `git hook` the way that git does and passes everything else to the
// real git, which runs the hook files just as the older one would.
const realGit = execFileSync("sh", ["-c", "command -v git"], {
  env,
  encoding: "utf8",
}).trim();

const olderGits = [
  {
    // `git hook run` without `list`, as on 2.36 to 2.53.
    name: "git hook without list",
    answer: `[ "$2" = list ] && { echo "error: unknown subcommand: list" >&2; exit 129; }`,
  },
  {
    // Before 2.36: no `git hook` at all, exit 1, the code a newer git gives
    // for "no hooks found".
    name: "no git hook at all",
    answer: `echo "git: 'hook' is not a git command. See 'git --help'." >&2; exit 1`,
  },
] as const;

function olderGitEnv(name: string, answer: string): NodeJS.ProcessEnv {
  const bin = join(scratch, `older-git-${name.replaceAll(" ", "-")}`);
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\nif [ "$1" = hook ]; then ${answer}; fi\nexec "${realGit}" "$@"\n`
  );
  chmodSync(join(bin, "git"), 0o755);
  return { ...env, PATH: `${bin}${delimiter}${env.PATH ?? ""}` };
}

describe.each(olderGits)("on an older git: $name", ({ name, answer }) => {
  const older = olderGitEnv(name, answer);
  const slug = name.replaceAll(" ", "-");

  it("is the older git that answers", () => {
    const listed = spawnSync("git", ["hook", "list", "pre-commit"], {
      cwd: scratch,
      env: older,
    });
    expect(listed.status).not.toBe(0);
  });

  it("finds the hook in .git/hooks, and times it", fenceRuns, async () => {
    const repo = guestRepo(`older-${slug}`);
    hook(repo, typecheckHook);
    const report = await fenced(repo, older);
    expect(report).toMatchObject({ hooks: ["pre-commit"] });
    expect(fenceClaim(report).ok).toBe(true);
    expect(fenceClaim(report).detail).toMatch(/Hook time: \d+\.\d s/);
  });

  it("finds the hook in core.hooksPath", fenceRuns, async () => {
    const report = await fenced(hooksPathRepo(`older-path-${slug}`), older);
    expect(report).toMatchObject({ hooks: ["commit-msg"] });
  });

  it("still finds no hook when there is none", fenceRuns, async () => {
    const report = await fenced(guestRepo(`older-none-${slug}`), older);
    expect(report).toMatchObject({ hooks: [] });
    expect(fenceClaim(report).detail).toContain("No commit hook found");
  });
});

// The probe file has to get past the guest's own formatter and lint, or the
// control is refused and the check can't tell broken from fine. These hooks
// run the starter's oxfmt and oxlint by full path: a formatter check, and a
// lint set that bans every comment (a JS plugin, as rat-stack's is), wants
// function expressions and no inferrable types.

const oxfmt = join(starter, "node_modules", ".bin", "oxfmt");
const oxlint = join(starter, "node_modules", ".bin", "oxlint");

const noCommentsPlugin = `export default {
  meta: { name: "no-comments" },
  rules: {
    "no-comments": {
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              context.report({ message: "Comments are banned.", loc: comment.loc });
            }
          },
        };
      },
    },
  },
};
`;

const strictHook = [
  `files=$(git ls-files -- '*.ts')`,
  `${oxfmt} --check $files || exit 1`,
  `${oxlint} -c .oxlintrc.json --deny-warnings $files || exit 1`,
  typecheckHook,
].join("\n");

function strictRepo(name: string, opts: { semi: boolean }): string {
  const repo = guestRepo(name);
  writeFileSync(join(repo, "no-comments.mjs"), noCommentsPlugin);
  writeFileSync(
    join(repo, ".oxlintrc.json"),
    JSON.stringify({
      jsPlugins: ["./no-comments.mjs"],
      rules: {
        "no-comments/no-comments": "error",
        "func-style": ["error", "expression"],
        "no-empty-function": "error",
        "typescript/no-inferrable-types": "error",
      },
    })
  );
  writeFileSync(
    join(repo, ".oxfmtrc.json"),
    JSON.stringify(opts.semi ? {} : { semi: false })
  );
  writeFileSync(
    join(repo, "src", "tool.ts"),
    `export const x = 1${opts.semi ? ";" : ""}\n`
  );
  sh(repo, "add", ".");
  sh(
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "-m",
    "lint and format"
  );
  hook(repo, strictHook);
  return repo;
}

describe("a probe the guest's own lint and formatter accept", fenceRuns, () => {
  it("is what oxfmt prints, has no comment, and keeps one type error", () => {
    expect(wellTyped).not.toMatch(/\/\/|\/\*/);
    expect(typeBroken).not.toMatch(/\/\/|\/\*/);
    expect(wellTyped.replace(": number =>", ": string =>")).toBe(typeBroken);
  });

  it("passes a hook with a formatter check and a lint that bans comments", async () => {
    const repo = strictRepo("strict", { semi: true });
    // The lint does ban comments: the probe this check used to write fails it.
    writeFileSync(
      join(repo, "src", "commented.ts"),
      "// a comment\nexport const y = (value: number): number => value;\n"
    );
    const lint = spawnSync(
      oxlint,
      ["-c", ".oxlintrc.json", "--deny-warnings", "src/commented.ts"],
      { cwd: repo, env, encoding: "utf8" }
    );
    expect(lint.status).not.toBe(0);
    expect(lint.stdout).toContain("Comments are banned");
    rmSync(join(repo, "src", "commented.ts"));
    const report = await fenced(repo);
    expect(report).toMatchObject({
      control: { refused: false },
      broken: { refused: true },
    });
    expect(fenceClaim(report).ok).toBe(true);
  });

  it("drops the semicolon in a repo written without them", async () => {
    const report = await fenced(strictRepo("nosemi", { semi: false }));
    expect(report).toMatchObject({
      control: { refused: false },
      broken: { refused: true },
    });
    expect(fenceClaim(report).ok).toBe(true);
  });

  it("follows the guest's files, by majority, and defaults to semicolons", () => {
    expect(writesSemicolons([])).toBe(true);
    expect(
      writesSemicolons(["export const a = 1\n", "export const b = 2\n"])
    ).toBe(false);
    expect(
      writesSemicolons(["export const a = 1;\n", "export const b = 2\n"])
    ).toBe(true);
    expect(writesSemicolons(["", "  \n"])).toBe(true);
  });
});
