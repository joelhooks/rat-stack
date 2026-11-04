import type { Verdict } from "@rat-stack/check-harness";
import { Effect, Layer } from "effect";

import type { DeployRunner } from "../../src/deploy-runner.js";
import { RollbackRunner } from "../../src/rollback-runner.js";

export const passedWatchCheck: Verdict = {
  check: "post-deploy-watch",
  control: 1,
  counts: { cycles: 1 },
  exitCode: 0,
  observedAt: 1,
  outcome: "passed",
  reason: "bounded-watch-confirmed",
  status: "green",
};

export const passingWatch = {
  recordWatch: () => Effect.succeed("watch.json"),
  watch: () => Effect.succeed(passedWatchCheck),
} satisfies Pick<DeployRunner["Service"], "recordWatch" | "watch">;

export const unusedRollback = Layer.succeed(
  RollbackRunner,
  RollbackRunner.of({
    check: () => Effect.die("rollback-must-not-run"),
    load: () => Effect.die("rollback-must-not-run"),
    record: () => Effect.die("rollback-must-not-run"),
    restore: () => Effect.die("rollback-must-not-run"),
  })
);
