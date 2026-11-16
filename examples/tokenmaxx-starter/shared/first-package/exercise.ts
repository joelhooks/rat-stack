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
  type Reporter,
  reporter,
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

// A NOTE line: a line `done` still checks but doesn't need.
const noteLine = (note: Claim) => `${note.name}: ${note.ok ? "yes" : "no"}`;

// DRAFT closing lines.
const doneLine = (ok: boolean) =>
  ok ? "Done: the fence holds." : "Not done yet.";

function print(
  report: Reporter,
  claims: readonly Claim[],
  notes: readonly Claim[],
  stretch: Stretch | null
) {
  for (const claim of claims) {
    report.check(claim.ok ? "PASS" : "FAIL", claim.name, claim.detail);
  }
  for (const note of notes) {
    report.check("NOTE", noteLine(note), note.detail);
  }
  if (stretch !== null) {
    report.check(
      "STRETCH",
      `${stretch.name}: ${stretch.held ? "held" : "not held"}`,
      stretch.detail
    );
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
        r.verdict(doneLine(saved.value.claims.every((c) => c.ok)));
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
        // The guest's repo, which holds the starter when it was pulled in.
        // Compared by real path: TMX_GUEST_ROOT can name the starter itself
        // through a symlink (macOS's /var is one to /private/var).
        const root = ctx.guestRoot;
        const nested = real(root) !== real(ctx.repoRoot);
        const supplied = nested
          ? [relative(real(root), real(ctx.repoRoot))]
          : suppliedFolders;
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
        r.verdict(doneLine(ok));
        return ok ? 0 : 1;
      },
    },
  });
}
