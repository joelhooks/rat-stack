import { realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, relative } from "node:path";

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
import { type FenceReport, suppliedFolders, tryFence } from "./fence.ts";
import { type ProbeOutcome, probeFreshPi } from "./probe.ts";

/** What `done` looks at, each one swappable in tests. */
export type FirstPackageDeps = {
  /**
   * The fence test of the guest's repo at `root`, with no probe file in the
   * starter's own `supplied` folders.
   */
  readonly fence: (
    root: string,
    supplied: readonly string[]
  ) => Promise<FenceReport>;
  /**
   * A fresh Pi as `pnpm pi` starts it from the starter at `repoRoot`, so at
   * the guest's root; `trusted: false` ignores that repo's own resources.
   */
  readonly probe: (repoRoot: string, trusted: boolean) => Promise<ProbeOutcome>;
  readonly out: (line: string) => void;
};

export const untrustedArgs = (args: readonly string[]) =>
  args.map((arg) => (arg === "--approve" ? "--no-approve" : arg));

const defaultDeps: FirstPackageDeps = {
  fence: (root, supplied) => tryFence(root, { supplied }),
  probe: (repoRoot, trusted) =>
    probeFreshPi(repoRoot, trusted ? {} : { mapArgs: untrustedArgs }),
  out: (line) => console.log(line),
};

const SavedClaim = Schema.Struct({
  name: Schema.String,
  ok: Schema.Boolean,
  detail: Schema.String,
});

const SavedDone = Schema.Struct({
  at: Schema.String,
  claims: Schema.Array(SavedClaim),
  notes: Schema.Array(SavedClaim),
  stretch: Schema.NullOr(
    Schema.Struct({
      name: Schema.String,
      held: Schema.Boolean,
      detail: Schema.String,
    })
  ),
});

const savedPath = (ctx: ExerciseContext) => join(ctx.stateDir, "done.json");

const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const indent = (text: string) =>
  text.split("\n").map((line) => `      ${line}`);

// DRAFT label for a line `done` still checks but doesn't need. Joel may
// change the wording.
const noteLine = (note: Claim) =>
  `NOTE  ${note.name}: ${note.ok ? "yes" : "no"}, not needed for done`;

// DRAFT closing lines.
const doneLine = (ok: boolean) =>
  ok ? "Done: the fence holds." : "Not done yet.";

function print(
  out: (line: string) => void,
  claims: readonly Claim[],
  notes: readonly Claim[],
  stretch: Stretch | null
) {
  for (const claim of claims) {
    out(`${claim.ok ? "PASS" : "FAIL"}  ${claim.name}`);
    indent(claim.detail).forEach((line) => out(line));
  }
  for (const note of notes) {
    out(noteLine(note));
    indent(note.detail).forEach((line) => out(line));
  }
  if (stretch !== null) {
    out(`STRETCH  ${stretch.name}: ${stretch.held ? "held" : "not held"}`);
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
        print(out, saved.value.claims, saved.value.notes, saved.value.stretch);
        out(doneLine(saved.value.claims.every((c) => c.ok)));
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

      /** The done check: PASS when the fence holds. The notes never count. */
      async done(ctx) {
        // The guest's repo, which holds the starter when it was pulled in.
        // Compared by real path: TMX_GUEST_ROOT can name the starter itself
        // through a symlink (macOS's /var is one to /private/var).
        const root = ctx.guestRoot;
        const nested = real(root) !== real(ctx.repoRoot);
        const supplied = nested
          ? [relative(real(root), real(ctx.repoRoot))]
          : suppliedFolders;
        if (nested) {
          out(
            `Checking your repo at ${root} (the workshop tools are in its ${supplied.join("")}/ folder).`
          );
        }
        out(
          "Trying a commit with a type error in a throwaway copy of the repo, then a fresh Pi there trying to skip the hook..."
        );
        const fence = await deps.fence(root, supplied);
        out("Starting a fresh Pi against a local fake model...");
        const trusted = await deps.probe(ctx.repoRoot, true);
        const untrusted = trusted.ok
          ? await deps.probe(ctx.repoRoot, false)
          : null;
        const claims = [fenceClaim(fence)];
        const notes = [
          packageClaim(trusted, untrusted),
          whyClaim(await findWhyFiles(root)),
        ];
        const stretch = stretchLine(fence);
        out("");
        print(out, claims, notes, stretch);
        const warning = changedWarning(fence);
        if (warning !== null) {
          out(warning);
        }
        await writeJsonAtomic(savedPath(ctx), {
          at: now(),
          claims,
          notes,
          stretch,
        });
        const ok = claims.every((c) => c.ok);
        out(doneLine(ok));
        return ok ? 0 : 1;
      },
    },
  });
}
