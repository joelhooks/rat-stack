import { realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, relative } from "node:path";

import { Schema } from "effect";

import { catchUp } from "#shared/core/catch-up.ts";
import type { ExerciseContext } from "#shared/core/context.ts";
import { defineExercise, type Exercise } from "#shared/core/exercise.ts";
import { now } from "#shared/core/paths.ts";
import {
  detailsFlag,
  nextAfter,
  type Reporter,
  reporter,
  sentence,
  shortPath,
  takeDetails,
} from "#shared/core/report.ts";
import { tryReadJson, writeJsonAtomic } from "#shared/core/store.ts";

import {
  catchUpArchive,
  catchUpDir,
  startedPackage,
  unpackCatchUp,
} from "./catch-up.ts";
import {
  changedWarning,
  fenceClaim,
  findWhyFiles,
  packageClaim,
  says,
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

// `says` is new in 0.4.1: a result saved before it is shown by name.
const SavedClaim = Schema.Struct({
  name: Schema.String,
  ok: Schema.Boolean,
  says: Schema.optional(Schema.String),
  detail: Schema.String,
});
type SavedClaim = typeof SavedClaim.Type;

const SavedDone = Schema.Struct({
  at: Schema.String,
  claims: Schema.Array(SavedClaim),
  notes: Schema.Array(SavedClaim),
  stretch: Schema.NullOr(
    Schema.Struct({
      name: Schema.String,
      held: Schema.Boolean,
      says: Schema.optional(Schema.String),
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

const saysOf = (claim: { name: string; says?: string }, ok: boolean) =>
  claim.says ?? sentence(says, claim.name, ok);

/** The checks, then the closing lines. NOTE and STRETCH lines don't count. */
function print(
  report: Reporter,
  claims: readonly SavedClaim[],
  notes: readonly SavedClaim[],
  stretch: { name: string; held: boolean; says?: string; detail: string } | null
) {
  for (const claim of claims) {
    report.check(
      claim.ok ? "PASS" : "FAIL",
      saysOf(claim, claim.ok),
      claim.detail
    );
  }
  for (const note of notes) {
    report.check("NOTE", saysOf(note, note.ok), note.detail);
  }
  if (stretch !== null) {
    report.check("STRETCH", saysOf(stretch, stretch.held), stretch.detail);
  }
}

/**
 * Where 01.1 looks, and where the next exercise runs when that's elsewhere:
 * 01.1 checks the guest's own repo; the day runs 02.1 onward in the separate
 * tokenmaxx folder every guest made in setup, whatever folder ran this.
 */
function placesFor(ctx: ExerciseContext) {
  // The guest's repo, which holds the starter when it was pulled in.
  // Compared by real path: TMX_GUEST_ROOT can name the starter itself
  // through a symlink (macOS's /var is one to /private/var).
  const root = ctx.guestRoot;
  const nested = real(root) !== real(ctx.repoRoot);
  const inside = relative(real(root), real(ctx.repoRoot));
  return {
    root,
    nested,
    supplied: nested ? [inside] : suppliedFolders,
    nextIn: nested ? "your tokenmaxx folder" : undefined,
  };
}

function close(
  id: string,
  report: Reporter,
  ok: boolean,
  nextIn: string | undefined
) {
  if (ok) {
    report.done("Done: the fence holds.", nextAfter(id, nextIn));
  } else {
    report.notDone();
  }
}

export function firstPackageExercise(
  opts: { readonly id: string; readonly title: string },
  deps: FirstPackageDeps = defaultDeps
): Exercise {
  const { out } = deps;
  const ex = (command: string) => `pnpm ex ${opts.id} ${command}`;
  const report = (command: string, args: readonly string[]) =>
    reporter(out, {
      id: opts.id,
      title: opts.title,
      command: `${ex(command)} ${detailsFlag}`,
      details: takeDetails(args).details,
    });
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
      async status(ctx, args) {
        const saved = await tryReadJson(savedPath(ctx), SavedDone);
        if (!saved.ok) {
          out(`No result yet. Run ${ex("done")}.`);
          return 0;
        }
        const r = report("status", args);
        r.header(`last done, at ${saved.value.at}`);
        r.line("");
        print(r, saved.value.claims, saved.value.notes, saved.value.stretch);
        close(
          opts.id,
          r,
          saved.value.claims.every((c) => c.ok),
          placesFor(ctx).nextIn
        );
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
      async done(ctx, args) {
        const r = report("done", args);
        const { root, nested, supplied, nextIn } = placesFor(ctx);
        r.header(
          nested
            ? `checking ${shortPath(root)} (tools in ${supplied.join("")}/)`
            : `checking ${shortPath(root)}`
        );
        r.line("");
        const fence = await r.during(
          "Trying a type-broken commit in a throwaway copy (about 30 s)...",
          () => deps.fence(root, supplied)
        );
        const [trusted, untrusted] = await r.during(
          "Starting a fresh Pi against a local fake model...",
          async () => {
            const withRepo = await deps.probe(ctx.repoRoot, true);
            return [
              withRepo,
              withRepo.ok ? await deps.probe(ctx.repoRoot, false) : null,
            ] as const;
          }
        );
        const claims = [fenceClaim(fence)];
        const notes = [
          packageClaim(trusted, untrusted),
          whyClaim(await findWhyFiles(root)),
        ];
        const stretch = stretchLine(fence);
        print(r, claims, notes, stretch);
        const warning = changedWarning(fence);
        if (warning !== null) {
          r.aside(warning);
        }
        await writeJsonAtomic(savedPath(ctx), {
          at: now(),
          claims,
          notes,
          stretch,
        });
        const ok = claims.every((c) => c.ok);
        close(opts.id, r, ok, nextIn);
        return ok ? 0 : 1;
      },
    },
  });
}
