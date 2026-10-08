import { expect, it } from "@effect/vitest";
import { Approval } from "@rat-stack/capability/approval";
import { gateOutcome } from "@rat-stack/check-harness";
import { createEffectActor, join } from "@xstate/effect";
import { Clock, Effect, Fiber, Option, Schema } from "effect";
import { TestClock } from "effect/testing";

import { summarizeApply } from "../src/apply-receipt.js";
import { DeployRunner } from "../src/deploy-runner.js";
import { deployMachine } from "../src/machine.js";
import {
  readWorkerVersionSet,
  settledWorkerVersion,
} from "../src/worker-version-readback.js";

it.effect.prop(
  "full-cutover attributes without a version ID still produce an applied receipt with authoritative live identities",
  { attributeId: Schema.optionalKey(Schema.String) },
  ({ attributeId }) =>
    Effect.gen(function* model() {
      const names = [
        "fixture-mischief-script",
        "fixture-website-script",
        "fixture-rpc-script",
      ];

      const fetched: string[] = [];

      const result = yield* readWorkerVersionSet(
        names.map((workerName) => ({
          action: "update",
          attributes: { versionId: attributeId, workerName },
        })),
        Object.fromEntries(names.map((name) => [name, `old:${name}`])),
        (worker) =>
          Effect.sync(() => {
            fetched.push(worker);

            return Option.some(`new:${worker}`);
          }),
        { deadlineMs: 50, initialDelayMs: 10, maximumDelayMs: 10 }
      );

      const receipt = {
        ...summarizeApply(
          ["Mischief", "Website", "RpcBackend"],
          ["Mischief", "Website", "RpcBackend"],
          "success",
          []
        ),
        versionReadbacks: result.checks,
        versions: result.versions,
      };

      expect(receipt.outcome).toBe("applied");
      expect(receipt.notUpdated).toStrictEqual([]);
      expect(receipt.versions).toStrictEqual(
        Object.fromEntries(names.map((name) => [name, `new:${name}`]))
      );
      expect(fetched).toStrictEqual(names);
      expect(
        result.checks.every((check) => gateOutcome(check) === "pass")
      ).toBe(true);
    }),
  { arbitrary: { runs: 50 } }
);

it.effect.prop(
  "live listing histories settle only when a new single deployment arrives before the deadline",
  {
    delayed: Schema.Int.check(Schema.isBetween({ maximum: 8, minimum: 0 })),
    missing: Schema.Boolean,
  },
  ({ delayed, missing }) =>
    Effect.gen(function* model() {
      const observations: number[] = [];

      const read = Effect.gen(function* observe() {
        const now = yield* Clock.currentTimeMillis;
        const settled = observations.length >= delayed;
        observations.push(now);

        if (settled) {
          return Option.some("new-version");
        }

        return missing ? Option.none<string>() : Option.some("old-version");
      });

      const fiber = yield* settledWorkerVersion(
        read,
        "fixture-script",
        "old-version",
        true,
        { deadlineMs: 50, initialDelayMs: 10, maximumDelayMs: 10 }
      ).pipe(Effect.forkChild);

      yield* TestClock.adjust(100);
      const check = yield* Fiber.join(fiber);
      const settles = delayed <= 5;
      expect(gateOutcome(check) === "pass").toBe(settles);
      expect(check.counts.attempts).toBe(Math.min(delayed + 1, 6));
      expect(check.counts.failedAttempts).toBe(settles ? delayed : 6);
      expect(check.provenance).toHaveLength(Math.min(delayed + 1, 6));
      expect(observations.at(-1)).toBeLessThanOrEqual(50);
    }),
  { arbitrary: { runs: 50 } }
);

it.effect(
  "a no-op Worker retains its current live version without waiting for a new deployment",
  () =>
    Effect.gen(function* seam() {
      const check = yield* settledWorkerVersion(
        Effect.succeed(Option.some("unchanged")),
        "fixture-script",
        "unchanged",
        false,
        { deadlineMs: 0, initialDelayMs: 1, maximumDelayMs: 1 }
      );

      expect(gateOutcome(check)).toBe("pass");
      expect(check.counts.attempts).toBe(1);
    })
);

it.effect.prop(
  "the production lifecycle classifies completed uploads as applied and failed qualification never as partial",
  { visible: Schema.Boolean },
  ({ visible }) =>
    Effect.gen(function* lifecycle() {
      const resources = ["Mischief", "Website", "RpcBackend"];

      const readback = yield* readWorkerVersionSet(
        resources.map((name) => ({
          action: "update",
          attributes: { workerName: `physical:${name}` },
        })),
        {},
        () =>
          Effect.succeed(
            visible ? Option.some("new-live-version") : Option.none<string>()
          ),
        { deadlineMs: 0, initialDelayMs: 1, maximumDelayMs: 1 }
      );

      const receipt = {
        ...summarizeApply(resources, resources, "success", []),
        versionReadbacks: readback.checks,
        versions: readback.versions,
      };

      const runner = DeployRunner.of({
        apply: () => Effect.succeed(receipt),
        checks: (applied) =>
          Effect.succeed([...(applied.versionReadbacks ?? [])]),
        plan: () =>
          Effect.succeed({
            receipt: { ...receipt, outcome: "prepared" as const },
            rows: resources.map((resource) => ({
              action: "update" as const,
              resource,
            })),
          }),
        preflight: () => Effect.succeed([]),
        source: () => Effect.succeed({ changed: [], head: "" }),
      });

      const actor = yield* createEffectActor(deployMachine, {
        input: { allow: [], mode: "prod", profile: "fixture" },
      }).pipe(
        Effect.provideService(DeployRunner, runner),
        Effect.provide(Approval.denyAll)
      );

      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Unexpected actor defects are not a passing qualification.
      const result = yield* join(actor).pipe(Effect.orDie);
      expect(result.outcome).toBe(visible ? "healthy" : "failed");
      expect(result.receipt?.outcome).toBe("applied");
      expect(result.checks).toHaveLength(3);
      expect(Object.keys(result.receipt?.versions ?? {})).toHaveLength(
        visible ? 3 : 0
      );
    }).pipe(Effect.scoped),
  { arbitrary: { runs: 20 } }
);
