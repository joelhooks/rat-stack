import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  getAgentDir,
  ProjectTrustStore,
} from "@earendil-works/pi-coding-agent";

import {
  type PinnedGitPackage,
  pinnedGitPackages,
} from "#shared/core/pi-settings.ts";

import { piCliPath } from "./pi.ts";

// `pnpm offline:prepare` readies a folder so `pnpm pi` starts with no network
// and no trust prompt. Both halves use Pi's own mechanisms (the Pi package's
// docs/packages.md and docs/security.md):
//
// - A project git package that already exists under `.pi/git/` loads as is.
//   Pi clones a missing one on a trusted start; it does not fetch one that is
//   there. So `pi install -l` each pinned source once, online. Local packages
//   load in place and need nothing.
// - Trust is a saved decision in `<agent dir>/trust.json`, keyed by the
//   folder's canonical path. Choosing Trust at the prompt writes the same entry.
//   A copied folder has a new path, so it needs its own entry.
//
// `pi install -l` keeps an entry's resource filters, so installing does not
// switch a package on. The output says "pinned package", not its name: guests
// meet these packages only after their own attempt.

/** Where Pi keeps a pinned git package's checkout. */
export const checkoutDir = (repoRoot: string, pkg: PinnedGitPackage) =>
  join(repoRoot, ".pi", "git", ...pkg.repo.split("/"));

/** The commit checked out in `dir`, or null when it is not a git checkout. */
export function checkedOutCommit(dir: string): string | null {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export type CheckoutState =
  | { readonly kind: "ready" }
  | { readonly kind: "missing" }
  | { readonly kind: "wrong-commit"; readonly commit: string }
  | { readonly kind: "no-dependencies" };

/** Whether `dir` holds `pinned` with its dependencies installed. */
export function checkoutState(dir: string, pinned: string): CheckoutState {
  const commit = checkedOutCommit(dir);
  if (commit === null) {
    return { kind: "missing" };
  }
  if (commit !== pinned) {
    return { kind: "wrong-commit", commit };
  }
  if (!existsSync(join(dir, "node_modules"))) {
    return { kind: "no-dependencies" };
  }
  return { kind: "ready" };
}

/** Saves "trust this folder" for every later Pi run that uses `agentDir`. */
export function trustFolder(repoRoot: string, agentDir = getAgentDir()) {
  const store = new ProjectTrustStore(agentDir);
  store.set(repoRoot, true);
  return {
    trustFile: join(agentDir, "trust.json"),
    trusted: store.get(repoRoot),
  };
}

/** Runs Pi's own installer for one pinned source into `.pi/git/`. */
export function installPinned(repoRoot: string, source: string): number {
  const run = spawnSync(
    process.execPath,
    [piCliPath(repoRoot), "install", "-l", "--approve", source],
    { cwd: repoRoot, stdio: "inherit" }
  );
  return run.status ?? 1;
}

export type Io = { out: (line: string) => void; err: (line: string) => void };

/**
 * pnpm records the folder's install path, and `verifyDepsBeforeRun: error`
 * refuses every script in a copy at a new path. This turns that into a warning
 * for one terminal, without changing the repo's setting.
 */
export const copiedFolderExport =
  "export pnpm_config_verify_deps_before_run=warn";

export function prepareOffline(
  repoRoot: string,
  io: Io,
  install: (repoRoot: string, source: string) => number = installPinned
): number {
  for (const pkg of pinnedGitPackages(repoRoot)) {
    const short = pkg.commit.slice(0, 7);
    const dir = checkoutDir(repoRoot, pkg);
    const before = checkoutState(dir, pkg.commit);
    if (before.kind === "ready") {
      io.out(`pinned package: already at ${short} in .pi/git/`);
      continue;
    }
    io.out(
      `pinned package: ${before.kind === "wrong-commit" ? `at ${before.commit.slice(0, 7)}` : before.kind}; installing ${short} (needs the network)`
    );
    const code = install(repoRoot, pkg.source);
    const after = checkoutState(dir, pkg.commit);
    if (code !== 0 || after.kind !== "ready") {
      io.err(
        `pinned package: install failed (exit ${code}, ${after.kind}). Run this once while online.`
      );
      return 1;
    }
    io.out(`pinned package: installed ${short} in .pi/git/`);
  }
  const { trustFile, trusted } = trustFolder(repoRoot);
  if (trusted !== true) {
    io.err(`trust: could not save a decision for ${repoRoot} in ${trustFile}`);
    return 1;
  }
  io.out(`trust: saved "Trust" for ${repoRoot} in ${trustFile}`);
  io.out("Ready: pnpm pi now starts without the network or the trust prompt.");
  io.out("");
  io.out(
    "If this folder is a copy, pnpm refuses to run scripts here: it checks the path pnpm install ran in, and a copy has a new one. Paste this into each terminal you use in the copy:"
  );
  io.out("");
  io.out(`  ${copiedFolderExport}`);
  return 0;
}
