import { describe, expect, it } from "@effect/vitest";
import { Approval } from "@rat-stack/capability/approval";
import type { Verdict } from "@rat-stack/check-harness";
import {
  Clock,
  ConfigProvider,
  Effect,
  Exit,
  Fiber,
  Layer,
  Schema,
  Scope,
} from "effect";
import { TestClock } from "effect/testing";

import { DeployStepError } from "../src/contracts.js";
import type { ApplyReceipt } from "../src/contracts.js";
import { DeployRunner } from "../src/deploy-runner.js";
import { runDeploy } from "../src/machine.js";
import type { RollbackReceipt } from "../src/rollback-contracts.js";
import { RollbackFailed } from "../src/rollback-failed.js";
import { RollbackRefused } from "../src/rollback-refused.js";
import { RollbackRunner } from "../src/rollback-runner.js";
import { lingeringWatchHost, WatchHost } from "../src/watch-host.js";
import type { WatchOutcome, WatchReceipt } from "../src/watch-receipt.js";
import { watchFailure } from "../src/watch-receipt.js";

const WatchSignal = Schema.Literals([
  "pass",
  "fail",
  "unknown",
  "crash",
  "refused",
]);

const RollbackSignal = Schema.Literals([
  "restored",
  "failed",
  "refused",
  "denied",
  "crash",
]);

const Command = Schema.Union([
  Schema.Struct({
    ms: Schema.Int.check(Schema.isBetween({ maximum: 700_000, minimum: 0 })),
    type: Schema.Literal("advance"),
  }),
  Schema.Struct({ type: Schema.Literal("interrupt") }),
]);

const Scenario = Schema.Struct({
  commands: Schema.Array(Command).check(Schema.isMaxLength(6)),
  rollback: RollbackSignal,
  watch: WatchSignal,
  watchMs: Schema.Int.check(Schema.isBetween({ maximum: 600_000, minimum: 1 })),
});

type ScenarioCase = typeof Scenario.Type;

const watchCheck = (signal: typeof WatchSignal.Type): Verdict => {
  const observed = {
    check: "post-deploy-watch",
    counts: {},
    observedAt: 1,
    reason: "synthetic",
  };

  if (signal === "pass") {
    return {
      ...observed,
      control: 1,
      exitCode: 0,
      outcome: "passed",
      status: "green",
    };
  }

  if (signal === "fail") {
    return {
      ...observed,
      control: 1,
      exitCode: 2,
      outcome: "failed",
      status: "red",
    };
  }

  return {
    ...observed,
    control: 0,
    exitCode: 3,
    outcome: "errored",
    status: "hold",
  };
};

const applied: ApplyReceipt = {
  appliedAt: 0,
  contentGeneration: "generation",
  notUpdated: [],
  outcome: "applied",
  previousVersions: { Mischief: "prior" },
  profile: "fixture",
  retainedOrphans: [],
  updated: ["Mischief"],
  versions: { Mischief: "next" },
};

const passed: Verdict = { ...watchCheck("pass"), check: "synthetic" };

const finishedOutcome = (scenario: ScenarioCase): WatchOutcome => {
  if (scenario.watch !== "pass" && scenario.watch !== "fail") {
    return "crashed";
  }

  if (scenario.watch === "pass") {
    return "passed";
  }

  return scenario.rollback === "restored" ? "rolled-back" : "rollback-failed";
};

const completed = (scenario: ScenarioCase) => ({
  outcome: finishedOutcome(scenario),
  rollbackLoads:
    scenario.watch === "fail" && scenario.rollback !== "denied" ? 1 : 0,
});

interface Expected {
  readonly interrupted: boolean;
  readonly outcome: WatchOutcome;
  readonly rollbackLoads: number;
}

const model = (scenario: ScenarioCase): Expected => {
  let elapsed = 0;

  for (const command of scenario.commands) {
    if (command.type === "interrupt") {
      return elapsed < scenario.watchMs
        ? { interrupted: true, outcome: "interrupted", rollbackLoads: 0 }
        : { ...completed(scenario), interrupted: true };
    }

    elapsed += command.ms;
  }

  return { ...completed(scenario), interrupted: false };
};

const rollbackReceipt = (outcome: RollbackReceipt["outcome"]) =>
  ({
    checks: [],
    completed: ["Mischief"],
    observedAt: 0,
    operation: "rollback",
    outcome,
    profile: "fixture",
    source: { path: "last-apply.json", profile: "fixture", receipt: applied },
    targets: { Mischief: "prior" },
    versions: { Mischief: "prior" },
  }) satisfies RollbackReceipt;

const replay = Effect.fn("replayWatchLifecycle")(function* replay(
  scenario: ScenarioCase
) {
  const recorded: WatchReceipt[] = [];
  const calls: string[] = [];
  let rollbackLoads = 0;

  const runner = DeployRunner.of({
    apply: () => Effect.succeed(applied),
    checks: () => Effect.succeed([passed]),
    plan: () =>
      Effect.succeed({
        receipt: { ...applied, outcome: "prepared" as const },
        rows: [{ action: "update" as const, resource: "Mischief" }],
      }),
    preflight: () => Effect.succeed([]),
    recordWatch: (receipt) =>
      Effect.sync(() => {
        recorded.push(receipt);

        return "watch.json";
      }),
    source: () => Effect.succeed({ changed: [], head: "a".repeat(40) }),
    watch: () =>
      Effect.sync(() => calls.push("watch")).pipe(
        Effect.andThen(Effect.sleep(scenario.watchMs)),
        Effect.andThen(
          Effect.suspend(() => {
            if (scenario.watch === "crash") {
              return Effect.die("watch-defect");
            }

            if (scenario.watch === "refused") {
              return Effect.fail(
                new DeployStepError({
                  keys: [],
                  reason: "profile-not-pinned",
                  step: "watch",
                })
              );
            }

            return Effect.succeed(watchCheck(scenario.watch));
          })
        )
      ),
  });

  const rollbacks = RollbackRunner.of({
    check: (receipt) => Effect.succeed({ ...receipt, outcome: "healthy" }),
    load: () =>
      Effect.suspend(() => {
        rollbackLoads += 1;

        if (scenario.rollback === "crash") {
          return Effect.die("rollback-defect");
        }

        return scenario.rollback === "refused"
          ? Effect.fail(
              new RollbackRefused({
                reason: "recovery-receipt-unavailable-or-invalid",
              })
            )
          : Effect.succeed({
              path: "last-apply.json",
              profile: "fixture",
              receipt: applied,
            });
      }),
    record: (receipt) => Effect.succeed(receipt),
    restore: () =>
      scenario.rollback === "failed"
        ? Effect.fail(
            new RollbackFailed({ receipt: rollbackReceipt("failed") })
          )
        : Effect.succeed(rollbackReceipt("restored")),
  });

  const scope = yield* Scope.make();
  const host = yield* Layer.buildWithScope(lingeringWatchHost, scope);

  const services = Layer.mergeAll(
    Layer.succeed(DeployRunner, runner),
    Layer.succeed(RollbackRunner, rollbacks),
    ConfigProvider.layer(ConfigProvider.fromUnknown({})),
    scenario.rollback === "denied" ? Approval.denyAll : Approval.allowAll
  );

  const started = yield* Clock.currentTimeMillis;

  const deploying = yield* runDeploy({
    allow: [],
    mode: "prod",
    profile: "fixture",
  }).pipe(
    Effect.provide(services),
    Effect.provideContext(host),
    Effect.forkChild
  );

  for (
    let turn = 0;
    turn < 200 && deploying.pollUnsafe() === undefined;
    turn += 1
  ) {
    yield* Effect.yieldNow;
  }

  expect(deploying.pollUnsafe()).toBeDefined();
  const verdict = yield* Fiber.join(deploying);

  expect(verdict.outcome).toBe("healthy");
  expect(yield* Clock.currentTimeMillis).toBe(started);
  expect(recorded).toStrictEqual([]);

  const settling = yield* WatchHost.use((watches) => watches.settle).pipe(
    Effect.provideContext(host),
    Effect.forkChild
  );

  const expected = model(scenario);
  let elapsed = 0;
  let settled: readonly WatchReceipt[] | undefined;

  for (const command of scenario.commands) {
    if (command.type === "interrupt") {
      break;
    }

    yield* TestClock.adjust(command.ms);
    elapsed += command.ms;

    if (elapsed >= scenario.watchMs && settled === undefined) {
      settled = yield* Fiber.join(settling);
    }
  }

  if (!expected.interrupted) {
    yield* TestClock.adjust(scenario.watchMs);
    settled ??= yield* Fiber.join(settling);
  }

  yield* Scope.close(scope, Exit.void);

  expect(recorded.map((receipt) => receipt.outcome)).toStrictEqual([
    expected.outcome,
  ]);
  expect(rollbackLoads).toBe(expected.rollbackLoads);

  if (expected.outcome !== "interrupted") {
    expect(calls).toStrictEqual(["watch"]);
  }

  const [receipt] = recorded;

  if (expected.outcome !== "interrupted") {
    expect(settled).toStrictEqual(recorded);
  }

  if (receipt === undefined) {
    return;
  }

  expect(receipt.profile).toBe("fixture");
  expect(watchFailure(receipt) === undefined).toBe(
    receipt.outcome === "passed"
  );
  expect(receipt.fix === undefined).toBe(receipt.outcome === "passed");
  expect(receipt.rollback !== undefined).toBe(
    receipt.outcome === "rolled-back" ||
      (receipt.outcome === "rollback-failed" && scenario.rollback === "failed")
  );
  expect(JSON.stringify(receipt)).not.toContain("defect");
});

describe("post-deploy watch lifecycle", () => {
  it.effect.prop(
    "the verdict returns before the watch; a later watch failure rolls back; an interrupt records why and never rolls back",
    { scenario: Scenario },
    ({ scenario }) => replay(scenario).pipe(Effect.scoped),
    { arbitrary: { runs: 300 } }
  );
});
