import { exerciseContext, findRepoRoot } from "#shared/core/context.ts";
import { sessionFromEnv } from "#shared/core/sessions.ts";

import {
  type PartId,
  partIds,
  readJob,
  scriptedWork,
  splitExerciseId,
  workerCommand,
  writeStamp,
} from "./job.ts";

// The 06.1 worker command, run from inside a worker's copy of the repo:
//
//   node <starter>/shared/split-job/worker.ts <part>        the scripted worker
//   node <starter>/shared/split-job/worker.ts stamp <part>  a worker's last step
//
// Run it by this absolute path, not a path inside the copy: the stamps go to
// the starter's state dir, which outlasts the copy.

const isPart = (value: string | undefined): value is PartId =>
  partIds.some((id) => id === value);

async function main(argv: readonly string[]): Promise<number> {
  const stampOnly = argv[0] === "stamp";
  const part = stampOnly ? argv[1] : argv[0];
  if (!isPart(part)) {
    console.error(
      `Usage: ${workerCommand()} <part>, or ${workerCommand("stamp")} <part>. Parts: ${partIds.join(", ")}.`
    );
    return 2;
  }
  const { stateDir } = exerciseContext({
    exerciseId: splitExerciseId,
    repoRoot: findRepoRoot(),
  });
  const job = await readJob(stateDir);
  if (job === null) {
    console.error(
      `No split job is set up. Run \`pnpm ex ${splitExerciseId} setup\` first.`
    );
    return 2;
  }
  const opts = {
    stateDir,
    job,
    part,
    cwd: process.cwd(),
    session: sessionFromEnv(),
  };
  if (stampOnly) {
    const stamp = await writeStamp({
      ...opts,
      scripted: false,
      reported: null,
    });
    const files = Object.keys(stamp.files);
    console.log(
      `Stamped part ${part} in ${stamp.copyRoot}: ${files.length === 0 ? `nothing in ${job.dir}/` : files.join(", ")}.`
    );
    return 0;
  }
  const outcome = await scriptedWork(opts);
  if (!outcome.ok) {
    console.error(outcome.reason);
    return 1;
  }
  console.log(`Part ${part}: wrote ${outcome.path}.`);
  console.log("done");
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
