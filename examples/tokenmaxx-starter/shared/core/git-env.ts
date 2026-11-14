import type { Env } from "./context.ts";

// Inside a git hook, git exports variables that point every git command at
// the repository being committed to: always `GIT_INDEX_FILE`, and `GIT_DIR`
// too for a commit made in a linked worktree. A git command run from the
// hook, or from anything the hook starts (a test suite, `pnpm ex ...`),
// inherits them. Aimed at another repo, it then fails ("index file open
// failed", "invalid object ... Error building trees") or, worse, writes
// commits, config and index entries into the repo being committed to.
//
// Every git call the starter makes goes through `gitEnv`, so it acts on the
// repo its cwd or `-C` names, wherever it runs from.

/**
 * The variables git itself lists as pointing at the current repository:
 * `git rev-parse --local-env-vars`, as of git 2.53.
 */
export const repoLocalGitVars = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
] as const;

const repoLocal: ReadonlySet<string> = new Set(repoLocalGitVars);

/** Env for a git command: `env` minus `repoLocalGitVars`. */
export function gitEnv(env: Env = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (!repoLocal.has(key)) {
      clean[key] = value;
    }
  }
  return clean;
}
