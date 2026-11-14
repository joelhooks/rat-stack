import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ExerciseContext = {
  /** e.g. `02.1` */
  readonly exerciseId: string;
  readonly repoRoot: string;
  /** Every file this exercise writes lives under here. */
  readonly stateDir: string;
};

export type Env = Readonly<Record<string, string | undefined>>;

const packageName = "tokenmaxx-starter";

/** Walks up from `from` to the directory whose package.json is this starter. */
export function findRepoRoot(
  from: string = dirname(fileURLToPath(import.meta.url))
): string {
  let dir = resolve(from);
  for (;;) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg) && readPackageName(pkg) === packageName) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`No ${packageName} package.json above ${from}`);
    }
    dir = parent;
  }
}

function readPackageName(path: string): string | undefined {
  const parsed: { name?: unknown } = JSON.parse(readFileSync(path, "utf8"));
  return typeof parsed.name === "string" ? parsed.name : undefined;
}

/**
 * The state dir is `<repoRoot>/.workshop-state/<exerciseId>` unless
 * `TMX_STATE_DIR` names one. Nothing is created here; a fresh folder works.
 */
export function exerciseContext(opts: {
  exerciseId: string;
  repoRoot?: string;
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
    stateDir,
  };
}

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
