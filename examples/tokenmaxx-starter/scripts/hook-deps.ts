import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The commit hook's first step. A new git worktree of this repo (a worker's
// copy) has no node_modules, so `pnpm check` can't run there: this installs
// them first, from the pnpm store the main checkout's install used, offline.
// Only when that fails does it go to the network. It runs before the
// worktree has any dependencies, so it imports nothing but Node.

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** The store the main checkout's node_modules came from, if git and pnpm say. */
function mainStore(): string | null {
  const common = spawnSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: root, encoding: "utf8" }
  );
  const gitDir = common.status === 0 ? common.stdout.trim() : "";
  if (basename(gitDir) !== ".git") {
    return null;
  }
  const modules = join(dirname(gitDir), "node_modules", ".modules.yaml");
  if (!existsSync(modules)) {
    return null;
  }
  const match = /^\s*"?storeDir"?\s*:\s*"?([^"\n]+?)"?,?\s*$/m.exec(
    readFileSync(modules, "utf8")
  );
  return match?.[1] ?? null;
}

const install = (args: readonly string[]) =>
  spawnSync("pnpm", ["install", "--frozen-lockfile", ...args], {
    cwd: root,
    stdio: "inherit",
  }).status === 0;

if (!existsSync(join(root, "node_modules"))) {
  const store = mainStore();
  const storeArgs = store === null ? [] : ["--store-dir", store];
  if (
    !install(["--offline", ...storeArgs]) &&
    !install(["--prefer-offline", ...storeArgs])
  ) {
    console.error(
      "Commit refused: couldn't install the dependencies here to run pnpm check. Run pnpm install, then commit again."
    );
    process.exit(1);
  }
}
