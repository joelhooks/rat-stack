import { join } from "node:path";

import { Schema } from "effect";

import type { ExerciseContext } from "#shared/core/context.ts";
import { defineExercise } from "#shared/core/exercise.ts";
import { now } from "#shared/core/paths.ts";
import {
  detailsFlag,
  type Reporter,
  reporter,
  takeDetails,
} from "#shared/core/report.ts";
import { tryReadJson, writeJsonAtomic } from "#shared/core/store.ts";

import {
  type CheckResult,
  checkPiConcurrent,
  checkPinnedPackage,
  checkPiTurn,
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

const report = (command: string, args: readonly string[]) =>
  reporter((line) => console.log(line), {
    id: "00.1",
    title: "Check your Pi",
    command: `pnpm ex 00.1 ${command} ${detailsFlag}`,
    details: takeDetails(args).details,
  });

/** One line per check; the model, detail and next step under a FAIL. */
function print(r: Reporter, results: readonly CheckResult[]) {
  for (const result of results) {
    r.check(
      result.ok ? "PASS" : "FAIL",
      result.name,
      [
        `model: ${result.model ?? "(none)"}`,
        result.detail,
        ...(result.next === null ? [] : [`next: ${result.next}`]),
      ].join("\n")
    );
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

    async status(ctx, args) {
      const saved = await tryReadJson(checksPath(ctx), SavedChecks);
      if (!saved.ok) {
        if (saved.error.reason !== "missing") {
          throw saved.error;
        }
        console.log("No checks run yet. Run: pnpm ex 00.1 check");
        return 1;
      }
      const r = report("status", args);
      r.header(`last check, at ${saved.value.at}`);
      r.line("");
      print(r, saved.value.results);
      r.verdict(
        saved.value.results.every((x) => x.ok)
          ? "Ready for the workshop."
          : "Not ready yet: see next steps above."
      );
      return saved.value.results.every((x) => x.ok) ? 0 : 1;
    },

    async check(ctx, args) {
      const r = report("check", args);
      r.header();
      r.line("");
      const turn = await r.during(
        "1/3 Asking Pi for a model turn with a tool call...",
        () => checkPiTurn(ctx.repoRoot)
      );
      print(r, [turn]);
      const pinned = await r.during(
        "2/3 Looking for the workshop's pinned packages...",
        () => checkPinnedPackage(ctx.repoRoot)
      );
      print(r, [pinned]);
      const concurrent = await r.during(
        "3/3 Running two Pi sessions at once...",
        () => checkPiConcurrent(ctx.repoRoot)
      );
      print(r, [concurrent]);
      const results = [turn, pinned, concurrent];
      await writeJsonAtomic(checksPath(ctx), { at: now(), results });
      const ok = results.every((x) => x.ok);
      r.verdict(
        ok ? "Ready for the workshop." : "Not ready yet: see next steps above."
      );
      return ok ? 0 : 1;
    },
  },
});
