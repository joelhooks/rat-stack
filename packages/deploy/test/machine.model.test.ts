import { describe, expect, it } from "@effect/vitest";
import type { Verdict } from "@rat-stack/check-harness";
import { createEffectActor, join, send } from "@xstate/effect";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { DeployStepError } from "../src/contracts.js";
import type { ApplyReceipt, DeployVerdict } from "../src/contracts.js";
import { DeployRunner } from "../src/deploy-runner.js";
import { deployMachine } from "../src/machine.js";

const Signal = Schema.Literals([
  "pass",
  "fail",
  "crash",
  "refused",
  "partial",
  "unknown",
]);

const Scenario = Schema.Struct({
  apply: Signal,
  checks: Signal,
  mode: Schema.Literals(["plan", "prod"]),
  plan: Signal,
  preflight: Signal,
});

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
      updated: ["One", "Two"],
      versions: {},
    };
  }

  if (signal === "partial") {
    return {
      notUpdated: ["Two"],
      outcome: "partial",
      updated: ["One"],
      versions: {},
    };
  }

  return {
    notUpdated: ["One", "Two"],
    outcome: "failed",
    updated: [],
    versions: {},
  };
};

interface Model {
  readonly calls: readonly string[];
  readonly outcome: DeployVerdict["outcome"];
}

const model = (scenario: typeof Scenario.Type): Model => {
  const calls = ["preflight"];

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

const planText = (signal: typeof Signal.Type) => {
  if (signal === "unknown") {
    return "";
  }

  if (signal === "pass") {
    return "Plan: 2 to update\n[One] update\n[Two] update";
  }

  return "Plan: 1 to delete\n[One] delete";
};

const replay = Effect.fn("replayDeployModel")(function* replay(
  scenario: typeof Scenario.Type,
  generated: readonly string[]
) {
  const calls: string[] = [];

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

  const runner = DeployRunner.of({
    apply: () => settle("apply", scenario.apply, receipt(scenario.apply)),
    checks: () => settle("checks", scenario.checks, [check(scenario.checks)]),
    plan: () => settle("plan", scenario.plan, planText(scenario.plan)),
    preflight: () =>
      settle("preflight", scenario.preflight, ["EXAMPLE_REQUIRED"]),
  });

  const actor = yield* createEffectActor(deployMachine, {
    input: { allow: [], mode: scenario.mode, profile: "test-profile" },
  }).pipe(Effect.provideService(DeployRunner, runner));

  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Machine-level errors remain defects; the model checks explicit terminal step outcomes.
  const result = yield* join(actor).pipe(Effect.orDie);
  const expected = model(scenario);
  expect(result.outcome).toBe(expected.outcome);
  expect(calls).toStrictEqual(expected.calls);

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
      }),
    { arbitrary: { runs: 300 } }
  );
});
