import { rm } from "node:fs/promises";
import { join } from "node:path";

import { Schema } from "effect";

import { catchUp } from "#shared/core/catch-up.ts";
import type { ExerciseContext } from "#shared/core/context.ts";
import { defineExercise, type Exercise } from "#shared/core/exercise.ts";
import { now } from "#shared/core/paths.ts";
import { tryReadJson, writeJsonAtomic } from "#shared/core/store.ts";

import {
  catchUpArchive,
  catchUpDir,
  startedPackage,
  unpackCatchUp,
} from "./catch-up.ts";
import {
  changedWarning,
  type Claim,
  fenceClaim,
  findWhyFiles,
  packageClaim,
  type Stretch,
  stretchLine,
  whyClaim,
} from "./claims.ts";
import { type FenceReport, tryFence } from "./fence.ts";
import { type ProbeOutcome, probeFreshPi } from "./probe.ts";

/** What `done` looks at, each one swappable in tests. */
export type FirstPackageDeps = {
  readonly fence: (repoRoot: string) => Promise<FenceReport>;
  /** A fresh Pi; `trusted: false` ignores this repo's own resources. */
  readonly probe: (repoRoot: string, trusted: boolean) => Promise<ProbeOutcome>;
  readonly out: (line: string) => void;
};

export const untrustedArgs = (args: readonly string[]) =>
  args.map((arg) => (arg === "--approve" ? "--no-approve" : arg));

const defaultDeps: FirstPackageDeps = {
  fence: (repoRoot) => tryFence(repoRoot),
  probe: (repoRoot, trusted) =>
    probeFreshPi(repoRoot, trusted ? {} : { mapArgs: untrustedArgs }),
  out: (line) => console.log(line),
};

const SavedDone = Schema.Struct({
  at: Schema.String,
  claims: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      ok: Schema.Boolean,
      detail: Schema.String,
    })
  ),
  stretch: Schema.NullOr(
    Schema.Struct({
      name: Schema.String,
      held: Schema.Boolean,
      detail: Schema.String,
    })
  ),
});

const savedPath = (ctx: ExerciseContext) => join(ctx.stateDir, "done.json");

const indent = (text: string) =>
  text.split("\n").map((line) => `      ${line}`);

function print(
  out: (line: string) => void,
  claims: readonly Claim[],
  stretch: Stretch | null
) {
  for (const claim of claims) {
    out(`${claim.ok ? "PASS" : "FAIL"}  ${claim.name}`);
    indent(claim.detail).forEach((line) => out(line));
  }
  if (stretch !== null) {
    out(`STRETCH  ${stretch.name}: ${stretch.held ? "yes" : "not yet"}`);
    indent(stretch.detail).forEach((line) => out(line));
  }
}

export function firstPackageExercise(
  opts: { readonly id: string; readonly title: string },
  deps: FirstPackageDeps = defaultDeps
): Exercise {
  const { out } = deps;
  const ex = (command: string) => `pnpm ex ${opts.id} ${command}`;
  return defineExercise({
    id: opts.id,
    title: opts.title,
    commands: {
      /** Nothing to seed: this exercise looks at the repo itself. */
      async setup(ctx) {
        await rm(savedPath(ctx), { force: true });
        out("Nothing to set up: this exercise checks the repo itself.");
        out(`When you think you're there: ${ex("done")}`);
        return 0;
      },

      /** The last `done` result, without running it again. */
      async status(ctx) {
        const saved = await tryReadJson(savedPath(ctx), SavedDone);
        if (!saved.ok) {
          out(`No result yet. Run ${ex("done")}.`);
          return 0;
        }
        out(`Last ${ex("done")}, at ${saved.value.at}:`);
        print(out, saved.value.claims, saved.value.stretch);
        return 0;
      },

      /** Unpacks a started package and switches it on. Not in this exercise's readme. */
      async "catch-up"(ctx, args) {
        const unpacked = await unpackCatchUp(
          catchUpArchive(ctx.repoRoot),
          catchUpDir(ctx.repoRoot)
        );
        out(
          unpacked === "unpacked"
            ? "Unpacked shared/first-package/catch-up.tgz into .pi/catch-up/01.1 (git ignores it)."
            : ".pi/catch-up/01.1 is already there; left as it is."
        );
        return catchUp(startedPackage, { out })(ctx, args);
      },

      /** The done check: PASS only when every claim holds. */
      async done(ctx) {
        out(
          "Trying a commit with a type error in a throwaway copy of the repo..."
        );
        const fence = await deps.fence(ctx.repoRoot);
        out("Starting a fresh Pi against a local fake model...");
        const trusted = await deps.probe(ctx.repoRoot, true);
        const untrusted = trusted.ok
          ? await deps.probe(ctx.repoRoot, false)
          : null;
        const claims = [
          fenceClaim(fence),
          packageClaim(trusted, untrusted),
          whyClaim(await findWhyFiles(ctx.repoRoot)),
        ];
        const stretch = stretchLine(fence);
        out("");
        print(out, claims, stretch);
        const warning = changedWarning(fence);
        if (warning !== null) {
          out(warning);
        }
        await writeJsonAtomic(savedPath(ctx), { at: now(), claims, stretch });
        const ok = claims.every((c) => c.ok);
        out(
          ok
            ? "Done: the fence holds, a fresh Pi loads your tool and skill, and the repo says why."
            : "Not done yet."
        );
        return ok ? 0 : 1;
      },
    },
  });
}
