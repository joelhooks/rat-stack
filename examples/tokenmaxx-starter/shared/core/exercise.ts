import type { ExerciseContext } from "./context.ts";

/** One exercise command. Returns the process exit code: 0 for success. */
export type ExerciseCommand = (
  ctx: ExerciseContext,
  args: readonly string[]
) => Promise<number>;

export type ExerciseCommands = {
  /** Seeds this exercise's state from fixtures so the folder runs cold. */
  readonly setup: ExerciseCommand;
  /** Prints what the exercise's state shows right now. */
  readonly status: ExerciseCommand;
  readonly [name: string]: ExerciseCommand;
};

export type Exercise = {
  /** Matches the folder prefix, e.g. `02.1` for `02.1-wake-me-when-done`. */
  readonly id: string;
  readonly title: string;
  readonly commands: ExerciseCommands;
};

/**
 * Declares an exercise. Each exercise folder default-exports one from its
 * `exercise.ts`; `pnpm ex` runs its commands. `test` is reserved: `pnpm ex
 * <id> test` runs vitest on the folder, the done check's own tests.
 */
export function defineExercise(exercise: Exercise): Exercise {
  if ("test" in exercise.commands) {
    throw new Error(
      `exercise ${exercise.id}: "test" is reserved for the runner`
    );
  }
  return exercise;
}
