import { join } from "node:path";

import type { ExerciseContext } from "./context.ts";

/**
 * `fixtures/input.txt` holds `oak\npine\n`.
 *
 * Line-count convention for this fixture, and the one every line-count oracle
 * and check in the workshop uses: count the `\n`-terminated lines. `oak\npine\n`
 * has 2 lines. A trailing newline does not start a third line, and text after
 * the last `\n` (none here) is not counted. Reporting 3 is the planted mistake.
 */
export const inputFixtureLineCount = 2;

export function inputFixturePath(
  ctx: Pick<ExerciseContext, "repoRoot">
): string {
  return join(ctx.repoRoot, "shared", "core", "fixtures", "input.txt");
}
