import { join, resolve } from "node:path";

import { findGuestRoot, guestRootEnv } from "./guest-root.ts";
import { findRepoRoot } from "./repo-root.ts";

export { findRepoRoot } from "./repo-root.ts";

export type ExerciseContext = {
  /** e.g. `02.1` */
  readonly exerciseId: string;
  /** The starter's own root: its scripts, shared code and state. */
  readonly repoRoot: string;
  /**
   * The repo the guest works in, where Pi runs: the starter root, or the
   * guest's repo when the starter is a folder inside it. See ./guest-root.ts.
   */
  readonly guestRoot: string;
  /** Every file this exercise writes lives under here. */
  readonly stateDir: string;
};

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * The state dir is `<repoRoot>/.workshop-state/<exerciseId>` unless
 * `TMX_STATE_DIR` names one. Nothing is created here; a fresh folder works.
 * The guest root is `guestRoot` when given, then `TMX_GUEST_ROOT` (which
 * `pnpm pi` exports), then found from the repo root.
 */
export function exerciseContext(opts: {
  exerciseId: string;
  repoRoot?: string;
  guestRoot?: string;
  env?: Env;
}): ExerciseContext {
  const repoRoot = opts.repoRoot ?? findRepoRoot();
  const env = opts.env ?? process.env;
  const override = env["TMX_STATE_DIR"];
  const stateDir =
    override !== undefined && override !== ""
      ? resolve(override)
      : join(repoRoot, ".workshop-state", opts.exerciseId);
  return {
    exerciseId: opts.exerciseId,
    repoRoot,
    guestRoot:
      opts.guestRoot ?? nonEmpty(env[guestRootEnv]) ?? findGuestRoot(repoRoot),
    stateDir,
  };
}

const nonEmpty = (value: string | undefined) =>
  value === undefined || value === "" ? undefined : value;

/**
 * The context `pnpm pi --exercise <id>` and `pnpm ex` hand to child processes
 * through `TMX_EXERCISE`. A Pi extension can use it to find the same state dir
 * as the exercise commands.
 */
export function contextFromEnv(
  env: Env = process.env,
  repoRoot?: string
): ExerciseContext {
  const exerciseId = env["TMX_EXERCISE"];
  if (exerciseId === undefined || exerciseId === "") {
    throw new Error(
      "TMX_EXERCISE is not set. Launch with `pnpm pi --exercise <id>`."
    );
  }
  return exerciseContext({
    exerciseId,
    env,
    ...(repoRoot === undefined ? {} : { repoRoot }),
  });
}
