import { existsSync, realpathSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { isAbsolute, join, posix, relative, sep } from "node:path";

import {
  type CommitClaim,
  commitLine,
  commitSays,
  markStepStart,
} from "#shared/core/commit-line.ts";
import type { ExerciseContext } from "#shared/core/context.ts";
import { defineExercise, type Exercise } from "#shared/core/exercise.ts";
import { now } from "#shared/core/paths.ts";
import {
  detailsFlag,
  nextAfter,
  reporter,
  saysOf,
  shortPath,
  takeDetails,
} from "#shared/core/report.ts";
import {
  suppliedFolders,
  writesSemicolons,
} from "#shared/first-package/fence.ts";

import { gitOut, nulList } from "./git.ts";
import {
  copyOpen,
  jobText,
  newJobId,
  ownedPath,
  partIds,
  readJob,
  readStamps,
  stampsDir,
  writeJob,
} from "./job.ts";
import { judge, says } from "./judge.ts";
import { observe } from "./observe.ts";

// The commands for 06.1. `setup` makes a new job and says where its files
// go; `job` prints it again; `status` shows the stamps workers have left;
// `done` reads the stamps and the guest's repo. The workers' command is
// `worker.ts`, run by its absolute path from inside each worker's copy.

export type SplitDeps = {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly now: () => Date;
  /** The commit line `done` ends with. */
  readonly commit: (ctx: ExerciseContext) => Promise<CommitClaim>;
};

const defaultDeps: SplitDeps = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  now: () => new Date(),
  commit: (ctx) => commitLine(ctx),
};

export const defaultFolder = "split-job";

/** A folder under the guest root, as `a/b`, or null when it leaves it. */
export function cleanFolder(arg: string): string | null {
  const folder = posix.normalize(arg.split(sep).join("/")).replace(/\/+$/, "");
  if (
    folder === "" ||
    folder === "." ||
    isAbsolute(arg) ||
    folder.startsWith("../") ||
    folder === ".." ||
    folder.split("/").includes(".git")
  ) {
    return null;
  }
  return folder;
}

/**
 * Whether the guest's own TypeScript ends statements with `;`, from at most
 * 200 tracked files outside the starter's folders. None means yes.
 */
async function guestSemicolons(guestRoot: string, starterRoot: string) {
  const starter = relative(guestRoot, starterRoot).split(sep).join("/");
  const skip =
    starter === "" ? suppliedFolders.map((f) => `${f}/`) : [`${starter}/`];
  const files = nulList(
    await gitOut(guestRoot, [
      "ls-files",
      "-z",
      "-c",
      "--",
      "*.ts",
      "*.tsx",
      "*.mts",
      "*.cts",
    ])
  ).filter(
    (file) =>
      !file.split("/").includes("node_modules") &&
      !skip.some((prefix) => file.startsWith(prefix))
  );
  const sources = await Promise.all(
    files
      .slice(0, 200)
      .map((file) => readFile(join(guestRoot, file), "utf8").catch(() => ""))
  );
  return writesSemicolons(sources);
}

export function splitExercise(
  opts: { readonly id: string; readonly title: string },
  deps: SplitDeps = defaultDeps
): Exercise {
  const { out, err } = deps;
  const ex = (command: string) => `pnpm ex ${opts.id} ${command}`;

  const loadJob = async (ctx: ExerciseContext) => {
    const job = await readJob(ctx.stateDir);
    if (job === null) {
      err(`No split job yet. Run ${ex("setup")}.`);
    }
    return job;
  };

  return defineExercise({
    id: opts.id,
    title: opts.title,
    commands: {
      /** A new job, in `split-job/` or the folder given. Forgets old stamps. */
      async setup(ctx, args) {
        const folder = cleanFolder(args[0] ?? defaultFolder);
        if (folder === null) {
          err(`${args[0] ?? ""} isn't a folder inside your repo.`);
          return 2;
        }
        await markStepStart(ctx, deps.now());
        const guestRoot = realpathSync(ctx.guestRoot);
        const head =
          (
            await gitOut(guestRoot, ["rev-parse", "--verify", "-q", "HEAD"])
          )?.trim() || null;
        const job = {
          jobId: newJobId(),
          guestRoot,
          dir: folder,
          setupHead: head,
          // Both real, so the starter's folder is found inside the guest's
          // repo even when one path runs through a symlink.
          semicolons: await guestSemicolons(
            guestRoot,
            realpathSync(ctx.repoRoot)
          ),
          at: now(),
        };
        await rm(stampsDir(ctx.stateDir), { recursive: true, force: true });
        await writeJob(ctx.stateDir, job);
        out(`New split job in ${guestRoot}:`);
        out("");
        jobText(job).forEach((line) => out(line));
        const already = partIds
          .map((id) => ownedPath(job, id))
          .filter((path) => existsSync(join(guestRoot, path)));
        if (already.length > 0) {
          out("");
          out(
            `Already in your repo from before: ${already.join(", ")}. Remove them, or pick another folder with ${ex("setup <folder>")}.`
          );
        }
        out("");
        out(`When the job's done: ${ex("done")}`);
        return 0;
      },

      /** The current job, as `setup` printed it. */
      async job(ctx) {
        const job = await loadJob(ctx);
        if (job === null) {
          return 1;
        }
        jobText(job).forEach((line) => out(line));
        return 0;
      },

      /** The job and every stamp so far, without judging them. */
      async status(ctx) {
        const job = await loadJob(ctx);
        if (job === null) {
          return 0;
        }
        out(
          `Job ${job.jobId}, set up ${job.at}, in ${job.guestRoot}/${job.dir}/`
        );
        const stamps = await readStamps(ctx.stateDir, job.jobId);
        if (stamps.length === 0) {
          out("No stamps yet.");
          return 0;
        }
        for (const stamp of stamps) {
          const who = stamp.scripted ? "scripted worker" : "worker";
          const files = Object.keys(stamp.files).join(", ") || "no files";
          out(
            `${stamp.at}  part ${stamp.part}  ${who}${stamp.reported === null ? "" : ` reported ${stamp.reported}`}`
          );
          out(
            `      copy ${stamp.copyRoot} (${copyOpen(stamp) ? "still there" : "closed"}): ${files}`
          );
        }
        return 0;
      },

      /** The done check: PASS only when every claim holds. */
      async done(ctx, args) {
        const r = reporter(out, {
          id: opts.id,
          title: opts.title,
          command: `${ex("done")} ${detailsFlag}`,
          details: takeDetails(args).details,
        });
        const job = await readJob(ctx.stateDir);
        if (job === null) {
          // No job: setup hasn't run, and there's nothing to check.
          r.header();
          r.line("");
          r.notStarted(ex("setup"));
          return 1;
        }
        if (!existsSync(job.guestRoot)) {
          err(`${job.guestRoot} is gone. Run ${ex("setup")} again.`);
          return 1;
        }
        r.header(`checking ${shortPath(job.guestRoot)}`);
        r.line("");
        const stamps = await readStamps(ctx.stateDir, job.jobId);
        const claims: readonly CommitClaim[] = [
          ...judge(await observe(job, stamps)),
          await r.during(
            "Checking the step's commit with your commit hooks...",
            () => deps.commit(ctx)
          ),
        ];
        for (const claim of claims) {
          r.check(
            claim.ok ? "PASS" : "FAIL",
            saysOf({ ...says, ...commitSays }, claim),
            claim.detail,
            claim.fix
          );
        }
        const ok = claims.every((c) => c.ok);
        if (ok) {
          r.done(
            "Done: three workers in their own copies, the broken part turned down, its work kept, and the step committed.",
            nextAfter(opts.id)
          );
        } else {
          r.notDone();
        }
        return ok ? 0 : 1;
      },
    },
  });
}
