import { join } from "node:path";

import { Schema } from "effect";

import type { ExerciseContext } from "#shared/core/context.ts";
import { defineExercise } from "#shared/core/exercise.ts";
import { now } from "#shared/core/paths.ts";
import { tryReadJson, writeJsonAtomic } from "#shared/core/store.ts";

import {
  type CheckResult,
  checkPiConcurrent,
  checkPinnedPackage,
  checkPiTurn,
  formatResult,
} from "../../../scripts/lib/pi-check.ts";

// The smallest exercise that shows the layout: commands get a context, write
// only under ctx.stateDir, and parse what they read back with a schema.

const SavedChecks = Schema.Struct({
  at: Schema.String,
  results: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      ok: Schema.Boolean,
      model: Schema.NullOr(Schema.String),
      detail: Schema.String,
      next: Schema.NullOr(Schema.String),
    })
  ),
});

const checksPath = (ctx: ExerciseContext) => join(ctx.stateDir, "checks.json");

function print(results: readonly CheckResult[]) {
  for (const result of results) {
    for (const line of formatResult(result)) {
      console.log(line);
    }
  }
}

export default defineExercise({
  id: "00.1",
  title: "Check your Pi",
  commands: {
    async setup(ctx) {
      console.log(`State for this exercise lives in ${ctx.stateDir}`);
      console.log("Nothing to seed. Next: pnpm ex 00.1 check");
      return 0;
    },

    async status(ctx) {
      const saved = await tryReadJson(checksPath(ctx), SavedChecks);
      if (!saved.ok) {
        if (saved.error.reason !== "missing") {
          throw saved.error;
        }
        console.log("No checks run yet. Run: pnpm ex 00.1 check");
        return 1;
      }
      console.log(`Last check: ${saved.value.at}`);
      print(saved.value.results);
      return saved.value.results.every((r) => r.ok) ? 0 : 1;
    },

    async check(ctx) {
      console.log("1/3 Asking Pi for a model turn with a tool call...");
      const turn = await checkPiTurn(ctx.repoRoot);
      print([turn]);
      console.log("2/3 Looking for the workshop's pinned packages...");
      const pinned = checkPinnedPackage(ctx.repoRoot);
      print([pinned]);
      console.log("3/3 Running two Pi sessions at once...");
      const concurrent = await checkPiConcurrent(ctx.repoRoot);
      print([concurrent]);
      const results = [turn, pinned, concurrent];
      await writeJsonAtomic(checksPath(ctx), { at: now(), results });
      const ok = results.every((r) => r.ok);
      console.log(
        ok ? "Ready for the workshop." : "Not ready yet: see next steps above."
      );
      return ok ? 0 : 1;
    },
  },
});
