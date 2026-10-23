import { NodeCrypto } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Approval } from "@rat-stack/capability/approval";
import {
  FlagActor,
  FlagJournal,
  FlagLedger,
  FlagExit,
  FlagThreshold,
  FlagTarget,
} from "@rat-stack/core/flag-control";
import {
  flipFeatureFlag,
  recordFlagEvidence,
} from "@rat-stack/core/flag-write-capabilities";
import { Flags, defineFlag } from "@rat-stack/core/flags";
import { Effect, Exit, Layer, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { TestClock } from "effect/testing";

import { kvFlagControlLayer, kvFlagsLayer } from "../src/kv.js";
import { memoryFlagsLayer } from "../src/memory.js";
import { makeKVDouble } from "./kv-double.js";

const scopedFlag = defineFlag("SCOPED_ROLLOUT", Schema.NumberFromString, {
  default: 0,
  owner: "tests",
  purpose: "Prove scoped ladder transitions.",
  readScope: Schema.Literals(["alpha", "beta"]),
  removeBy: "2099-01-01",
  rungs: [
    {
      authority: "agent",
      exit: FlagExit.cases.evidence.make({
        requirements: [
          {
            event: "check",
            read: "acceptance report",
            threshold: FlagThreshold.cases["at-least"].make({ count: 1 }),
          },
        ],
      }),
      name: "zero",
      value: 0,
    },
    {
      authority: "agent",
      exit: FlagExit.cases.evidence.make({
        requirements: [
          {
            event: "check",
            read: "acceptance report",
            threshold: FlagThreshold.cases["at-least"].make({ count: 1 }),
          },
        ],
      }),
      name: "one",
      value: 1,
    },
    {
      authority: "arbiter",
      exit: FlagExit.cases.evidence.make({
        requirements: [
          {
            event: "check",
            read: "acceptance report",
            threshold: FlagThreshold.cases["at-least"].make({ count: 1 }),
          },
        ],
      }),
      name: "two",
      value: 2,
    },
    {
      authority: "owner",
      exit: FlagExit.cases.final.make({}),
      name: "three",
      value: 3,
    },
  ],
});

const names = ["zero", "one", "two", "three"];

const Command = Schema.Struct({
  action: Schema.Literals(["evidence", "flip", "deny", "off"]),
  authority: Schema.Literals(["agent", "arbiter", "owner"]),
  observed: Schema.Int.check(Schema.isBetween({ maximum: 2, minimum: 0 })),
  quote: Schema.Boolean,
  scope: Schema.Literals(["alpha", "beta", "wrong"]),
  target: Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 0 })),
});

const command = (
  action: typeof Command.Type.action,
  scope: typeof Command.Type.scope,
  target: number,
  quote = false
): typeof Command.Type => ({
  action,
  authority: "owner",
  observed: 1,
  quote,
  scope,
  target,
});

const prefix = [
  command("evidence", "beta", 0),
  command("flip", "alpha", 1),
  command("evidence", "alpha", 0),
  command("flip", "alpha", 1),
  command("evidence", "alpha", 1),
  command("flip", "alpha", 2),
  command("deny", "alpha", 2, true),
  command("flip", "alpha", 2, true),
  command("evidence", "alpha", 2),
  command("flip", "alpha", 1, true),
  command("off", "alpha", 0),
  command("deny", "alpha", 1),
];

interface ModelPosition {
  at: number;
  evidence: boolean;
}

const modelAllows = (
  step: typeof Command.Type,
  state: ModelPosition | undefined
): boolean => {
  if (state === undefined) {
    return false;
  }

  if (step.action === "evidence") {
    return state.at < 3 && step.target === state.at;
  }

  if (step.action === "off") {
    return true;
  }

  if (
    step.action === "deny" ||
    step.target !== state.at + 1 ||
    !state.evidence
  ) {
    return false;
  }

  if (step.target >= 2 && (!step.quote || step.authority === "agent")) {
    return false;
  }

  return step.target < 3 || step.authority === "owner";
};

const runCommand = (step: typeof Command.Type) => {
  if (step.action === "evidence") {
    return recordFlagEvidence.handler({
      event: "check",
      name: scopedFlag.name,
      observed: step.observed,
      read: "acceptance report",
      ref: "measurement",
      rung: names[step.target] ?? "missing",
      scope: step.scope,
    });
  }

  const input: typeof flipFeatureFlag.contract.input.Type = {
    authority: step.authority,
    name: scopedFlag.name,
    reason: "model command",
    scope: step.scope,
    target:
      step.action === "off"
        ? FlagTarget.cases.off.make({})
        : FlagTarget.cases.rung.make({ name: names[step.target] ?? "missing" }),
  };

  const quoted = step.quote
    ? { ...input, approvalRef: "Approved this scoped climb." }
    : input;

  return flipFeatureFlag.handler(quoted);
};

const modelOutcome = (step: typeof Command.Type, allowed: boolean) => {
  if (allowed) {
    return "Succeeded";
  }

  return step.action === "deny" ? "Denied" : "Failed";
};

it.effect.prop(
  "generated scoped flips and evidence obey the independent ladder model and ledger every attempt",
  {
    backend: Schema.Literals(["memory", "kv"]),
    commands: Arbitrary.array(Arbitrary.schema(Command), { maxLength: 35 }),
  },
  ({ backend, commands }) =>
    Effect.gen(function* compareFlagHistory() {
      const double = yield* makeKVDouble;
      const registry = [scopedFlag];

      const layer =
        backend === "memory"
          ? memoryFlagsLayer(registry)
          : Layer.merge(
              kvFlagsLayer(registry, double.kv).pipe(
                Layer.provide(Flags.defaults(registry))
              ),
              kvFlagControlLayer(registry, double.kv)
            );

      yield* Effect.gen(function* compareCommands() {
        const ledger = yield* FlagLedger;
        const journal = yield* FlagJournal;

        const model = new Map(
          ["alpha", "beta"].map((scope) => [scope, { at: 0, evidence: false }])
        );

        let attempts = 0;

        for (const step of [...prefix, ...commands]) {
          yield* TestClock.adjust(1);
          const state = model.get(step.scope);
          const isEvidence = step.action === "evidence";
          const off = step.action === "off";

          const approval =
            off || step.action === "deny"
              ? Approval.denyAll
              : Approval.allowAll;

          const allowed = modelAllows(step, state);

          const result = yield* runCommand(step).pipe(
            Effect.provide(approval),
            Effect.exit
          );

          expect(Exit.isSuccess(result)).toBe(allowed);

          if (allowed && state !== undefined) {
            if (isEvidence) {
              state.evidence = step.observed >= 1;
            } else {
              state.at = off ? 0 : step.target;
              state.evidence = false;
            }
          }

          attempts += 1;
          const page = yield* journal.list({ limit: 100 });
          expect(page.changes).toHaveLength(attempts);
          expect(page.changes.at(-1)?.outcome).toBe(
            modelOutcome(step, allowed)
          );
          expect(
            page.changes.every((entry) => entry.actor === "model-caller")
          ).toBe(true);

          for (const [scope, expected] of model) {
            expect((yield* ledger.read(scopedFlag.name, scope)).rung).toBe(
              names[expected.at]
            );
            expect(
              yield* Flags.use((flags) => flags.get(scopedFlag, { scope }))
            ).toBe(expected.at);
          }
        }
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(FlagActor, "model-caller")
      );
    }).pipe(Effect.provide(NodeCrypto.layer))
);
