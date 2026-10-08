import { describe, expect, it } from "@effect/vitest";
import { Approval } from "@rat-stack/capability/approval";
import type { Verdict } from "@rat-stack/check-harness";
import { createEffectActor, join, send } from "@xstate/effect";
import { Clock, ConfigProvider, Effect, Fiber, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { TestClock } from "effect/testing";

import { DeployStepError } from "../src/contracts.js";
import type {
  ApplyReceipt,
  DeployInput,
  DeployVerdict,
} from "../src/contracts.js";
import { DeployRunner } from "../src/deploy-runner.js";
import { deployMachine } from "../src/machine.js";
import type { PlanRow } from "../src/plan.js";

const Signal = Schema.Literals([
  "pass",
  "fail",
  "crash",
  "refused",
  "partial",
  "unknown",
]);

const SourceSignal = Schema.Literals([
  "unchecked",
  "match",
  "moved",
  "dirty",
  "crash",
  "refused",
]);

const WindowSignal = Schema.Literals(["none", "clear", "waitable", "blocked"]);

const Scenario = Schema.Struct({
  apply: Signal,
  checks: Signal,
  mode: Schema.Literals(["plan", "prod"]),
  plan: Signal,
  preflight: Signal,
  source: SourceSignal,
  window: WindowSignal,
});

const expectedSha = "a".repeat(40);

const dayMs = 86_400_000;

const quietWindowEndMs = dayMs + 30 * 60_000;

const quietWindowEnv = (signal: typeof WindowSignal.Type) => {
  const windows =
    signal === "clear"
      ? [{ end: "13:00", start: "12:00" }]
      : [{ end: "00:30", start: "23:45" }];

  return {
    DEPLOY_QUIET_WINDOWS: signal === "none" ? "" : JSON.stringify(windows),
    DEPLOY_QUIET_WINDOW_MAX_WAIT_MS: signal === "blocked" ? "60000" : "3600000",
  };
};

const probes = Arbitrary.array(Arbitrary.schema(Schema.String), {
  maxLength: 20,
});

const check = (signal: typeof Signal.Type): Verdict => {
  const observed = {
    check: "synthetic",
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

  if (signal === "unknown") {
    return {
      ...observed,
      control: 0,
      exitCode: 3,
      outcome: "errored",
      status: "hold",
    };
  }

  return {
    ...observed,
    control: 1,
    exitCode: 2,
    outcome: "failed",
    status: "red",
  };
};

const receipt = (signal: typeof Signal.Type): ApplyReceipt => {
  if (signal === "pass") {
    return {
      notUpdated: [],
      outcome: "applied",
      retainedOrphans: [],
      updated: ["One", "Two"],
      versions: {},
    };
  }

  if (signal === "partial") {
    return {
      notUpdated: ["Two"],
      outcome: "partial",
      retainedOrphans: [],
      updated: ["One"],
      versions: {},
    };
  }

  return {
    notUpdated: ["One", "Two"],
    outcome: "failed",
    retainedOrphans: [],
    updated: [],
    versions: {},
  };
};

interface Model {
  readonly calls: readonly string[];
  readonly outcome: DeployVerdict["outcome"];
}

const model = (scenario: typeof Scenario.Type): Model => {
  const calls: string[] = [];

  if (scenario.source !== "unchecked") {
    calls.push("source");

    if (scenario.source !== "match") {
      return {
        calls,
        outcome: scenario.source === "crash" ? "crashed" : "refused",
      };
    }
  }

  calls.push("preflight");

  if (scenario.preflight !== "pass") {
    return {
      calls,
      outcome: scenario.preflight === "crash" ? "crashed" : "refused",
    };
  }

  calls.push("plan");

  if (scenario.plan === "crash") {
    return { calls, outcome: "crashed" };
  }

  if (scenario.plan === "refused") {
    return { calls, outcome: "refused" };
  }

  if (scenario.plan === "unknown") {
    return { calls, outcome: "unknown" };
  }

  if (scenario.plan !== "pass") {
    return { calls, outcome: "refused" };
  }

  if (scenario.mode === "plan") {
    return { calls, outcome: "planned" };
  }

  if (scenario.window === "blocked") {
    return { calls, outcome: "refused" };
  }

  calls.push("apply");

  if (scenario.apply === "crash") {
    return { calls, outcome: "crashed" };
  }

  if (scenario.apply === "partial") {
    return { calls, outcome: "partial" };
  }

  if (scenario.apply !== "pass") {
    return { calls, outcome: "failed" };
  }

  calls.push("checks");

  if (scenario.checks === "crash") {
    return { calls, outcome: "crashed" };
  }

  if (scenario.checks === "refused") {
    return { calls, outcome: "failed" };
  }

  if (scenario.checks === "unknown") {
    return { calls, outcome: "unknown" };
  }

  return { calls, outcome: scenario.checks === "pass" ? "healthy" : "failed" };
};

const generatedPlan = (signal: typeof Signal.Type): readonly PlanRow[] => {
  if (signal === "unknown") {
    return [
      { action: "update", resource: "One" },
      { action: "update", resource: "One" },
    ];
  }

  if (signal === "pass") {
    return [
      { action: "update", resource: "One" },
      { action: "update", resource: "Two" },
    ];
  }

  return [{ action: "delete", resource: "One" }];
};

const replay = Effect.fn("replayDeployModel")(function* replay(
  scenario: typeof Scenario.Type,
  generated: readonly string[]
) {
  const calls: string[] = [];
  let appliedAt = -1;

  const settle = <A>(
    step: DeployStepError["step"],
    signal: typeof Signal.Type,
    value: A
  ) =>
    Effect.suspend(() => {
      calls.push(step);

      if (signal === "crash") {
        return Effect.die("private-crash-detail");
      }

      if (signal === "refused" || (step === "preflight" && signal !== "pass")) {
        return Effect.fail(
          new DeployStepError({
            keys: ["EXAMPLE_REQUIRED"],
            reason: "credential-refused",
            step,
          })
        );
      }

      return Effect.succeed(value);
    });

  const checkout = {
    changed: scenario.source === "dirty" ? ["apps/web/src/main.ts"] : [],
    head: scenario.source === "moved" ? "b".repeat(40) : expectedSha,
  };

  const runner = DeployRunner.of({
    apply: () =>
      Clock.currentTimeMillis.pipe(
        Effect.tap((now) =>
          Effect.sync(() => {
            appliedAt = now;
          })
        ),
        Effect.andThen(settle("apply", scenario.apply, receipt(scenario.apply)))
      ),
    checks: () => settle("checks", scenario.checks, [check(scenario.checks)]),
    plan: () =>
      settle("plan", scenario.plan, {
        receipt: {
          ...receipt("fail"),
          contentGeneration: "test-generation",
          outcome: "prepared" as const,
        },
        rows: generatedPlan(scenario.plan),
      }),
    preflight: () =>
      settle("preflight", scenario.preflight, ["EXAMPLE_REQUIRED"]),
    source: () =>
      settle(
        "source",
        scenario.source === "crash" || scenario.source === "refused"
          ? scenario.source
          : "pass",
        checkout
      ),
  });

  yield* TestClock.setTime(dayMs - 10 * 60_000);

  const input: DeployInput = {
    allow: [],
    mode: scenario.mode,
    profile: "test-profile",
  };

  const actor = yield* createEffectActor(deployMachine, {
    input:
      scenario.source === "unchecked"
        ? input
        : { ...input, expectSha: expectedSha },
  }).pipe(
    Effect.provideService(DeployRunner, runner),
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnv({ env: quietWindowEnv(scenario.window) })
    ),
    Effect.provide(Approval.denyAll)
  );

  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Machine-level errors remain defects; the model checks explicit terminal step outcomes.
  const running = yield* join(actor).pipe(Effect.orDie, Effect.forkChild);
  yield* TestClock.adjust("2 hours");
  const result = yield* Fiber.join(running);
  const expected = model(scenario);
  expect(result.outcome).toBe(expected.outcome);
  expect(calls).toStrictEqual(expected.calls);

  if (calls.includes("apply")) {
    expect(appliedAt >= quietWindowEndMs).toBe(scenario.window === "waitable");
  }

  if (result.step === "quietWindow") {
    expect(result.reason).toBe("inside-quiet-window");
  }

  if (scenario.source === "moved" || scenario.source === "dirty") {
    expect(result.checkout).toStrictEqual(checkout);
    expect(result.reason).toBe(
      scenario.source === "moved"
        ? "checkout-head-does-not-match-expected-sha"
        : "checkout-has-uncommitted-changes"
    );
  }

  if (
    result.outcome === "crashed" &&
    calls.includes("apply") &&
    scenario.apply === "crash"
  ) {
    expect(result.receipt?.contentGeneration).toBe("test-generation");
  }

  if (result.outcome === "partial") {
    expect(result.receipt).toStrictEqual(receipt("partial"));
  }

  expect(JSON.stringify(result)).not.toContain("private-crash-detail");
  const terminal = actor.getSnapshot();

  for (const type of generated) {
    yield* send(actor, { type });
    yield* Effect.yieldNow;
    expect(actor.getSnapshot()).toBe(terminal);
    expect(calls).toStrictEqual(expected.calls);
  }
}, Effect.scoped);

const Passing = {
  apply: "pass",
  checks: "pass",
  mode: "prod",
  plan: "pass",
  preflight: "pass",
  source: "unchecked",
  window: "none",
} as const;

describe("deployment command model", () => {
  it.effect.prop(
    "generated step histories stop on refusal, partial apply, failure or crash; terminal probes cannot restart work",
    { generated: probes, scenario: Scenario },
    ({ generated, scenario }) =>
      Effect.gen(function* test() {
        yield* replay(scenario, generated);
        yield* replay({ ...Passing, preflight: scenario.preflight }, generated);
        yield* replay({ ...Passing, plan: scenario.plan }, generated);
        yield* replay({ ...Passing, apply: scenario.apply }, generated);
        yield* replay({ ...Passing, checks: scenario.checks }, generated);
        yield* replay({ ...Passing, mode: "plan" }, generated);
        yield* replay({ ...Passing, source: scenario.source }, generated);
        yield* replay({ ...Passing, window: scenario.window }, generated);
      }),
    { arbitrary: { runs: 300 } }
  );
});

const GeneratedRow = Schema.Struct({
  action: Schema.Literals(["create", "update", "replace", "delete", "noop"]),
  allowed: Schema.Boolean,
});

describe("plan guard", () => {
  it.effect.prop(
    "an unexpected create, delete or replace stops before apply and names the resource",
    {
      generated: Schema.Array(GeneratedRow).check(Schema.isMaxLength(12)),
      ownerApproved: Schema.Boolean,
    },
    ({ generated, ownerApproved }) =>
      Effect.gen(function* test() {
        const rows = generated.map((row, index) => ({
          action: row.action,
          resource: `Resource${index}`,
        }));

        const allow = rows.filter(
          (_, index) => generated[index]?.allowed === true
        );

        const calls: string[] = [];

        const runner = DeployRunner.of({
          apply: () =>
            Effect.sync(() => {
              calls.push("apply");

              return receipt("pass");
            }),
          checks: () => Effect.succeed([check("pass")]),
          plan: () =>
            Effect.succeed({
              receipt: { ...receipt("fail"), outcome: "prepared" as const },
              rows,
            }),
          preflight: () => Effect.succeed([]),
          source: () => Effect.succeed({ changed: [], head: expectedSha }),
        });

        const actor = yield* createEffectActor(deployMachine, {
          input: { allow, mode: "prod", ownerApproved, profile: "test" },
        }).pipe(
          Effect.provideService(DeployRunner, runner),
          Effect.provide(Approval.denyAll)
        );

        // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Machine-level errors remain defects; the property checks the refused verdict.
        const result = yield* join(actor).pipe(Effect.orDie);

        const unexpected = rows.filter(
          (row, index) =>
            (row.action === "create" ||
              row.action === "delete" ||
              row.action === "replace") &&
            (generated[index]?.allowed !== true ||
              (row.action !== "create" && !ownerApproved))
        );

        if (unexpected.length === 0) {
          expect(result.outcome).toBe("healthy");
          expect(calls).toStrictEqual(["apply"]);

          return;
        }

        expect(result.outcome).toBe("refused");
        expect(result.step).toBe("classify");
        expect(calls).toStrictEqual([]);
        const named = new Set(result.resources);

        expect(unexpected.some((row) => named.has(row.resource))).toBe(true);

        for (const resource of named) {
          expect(rows.some((row) => row.resource === resource)).toBe(true);
        }
      }),
    { arbitrary: { runs: 300 } }
  );
});
