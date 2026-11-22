import { join } from "node:path";

import { Schema } from "effect";

import type { ExerciseContext } from "#shared/core/context.ts";
import { defineExercise } from "#shared/core/exercise.ts";
import { now } from "#shared/core/paths.ts";
import {
  detailsFlag,
  type Reporter,
  reporter,
  type Says,
  sentence,
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

/** What `check` prints for each of its checks. */
const says: Readonly<Record<string, Says>> = {
  "a model turn with a tool call": {
    yes: "Pi got a reply from a model, and the model used a tool.",
    no: "Pi didn't get a model reply that used a tool.",
  },
  "pinned packages installed": {
    yes: "The workshop's pinned packages are installed.",
    no: "The workshop's pinned packages aren't installed yet.",
  },
  "two Pi sessions at once": {
    yes: "Two Pi sessions answered at the same time.",
    no: "Two Pi sessions didn't both answer at the same time.",
  },
};

/** One line per check; the model, detail and what to do under a FAIL. */
function print(r: Reporter, results: readonly CheckResult[]) {
  for (const result of results) {
    r.check(
      result.ok ? "PASS" : "FAIL",
      sentence(says, result.name, result.ok),
      [
        `Model: ${result.model ?? "(none)"}`,
        result.detail,
        ...(result.next === null ? [] : [`To fix: ${result.next}`]),
      ].join("\n"),
      result.next ?? undefined
    );
  }
}

/**
 * The closing lines. Done has no Next line: the setup page, which an agent
 * follows, goes on to the guest's own repo. 00.1 is fixed outside Pi, so a
 * FAIL's own fix is next.
 */
function close(r: Reporter, ok: boolean) {
  if (ok) {
    r.done("Ready for the workshop.");
  } else {
    r.notDone({
      words: "Not ready yet",
      otherwise: "do what To fix says under each FAIL, then run this again.",
    });
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
      close(
        r,
        saved.value.results.every((x) => x.ok)
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
      close(r, ok);
      return ok ? 0 : 1;
    },
  },
});
