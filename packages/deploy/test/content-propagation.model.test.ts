import { expect, it } from "@effect/vitest";
import { gateOutcome } from "@rat-stack/check-harness";
import type { Verdict } from "@rat-stack/check-harness";
import { Clock, Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";

import { settledContentVersionCheck } from "../src/checks.js";

it.effect.prop(
  "content histories converge only when a match arrives by the bounded deadline",
  {
    mismatches: Schema.Int.check(Schema.isBetween({ maximum: 8, minimum: 0 })),
  },
  ({ mismatches }) =>
    Effect.gen(function* model() {
      const observations: number[] = [];

      const work = Effect.gen(function* observe() {
        const observedAt = yield* Clock.currentTimeMillis;
        const pass = observations.length >= mismatches;
        observations.push(observedAt);

        return {
          check: "content-version:/",
          control: 1,
          counts: { observed: 1 },
          observedAt,
          reason: pass
            ? "content-version-confirmed"
            : "content-version-mismatch",
          ...(pass
            ? { exitCode: 0, outcome: "passed", status: "green" }
            : { exitCode: 2, outcome: "failed", status: "red" }),
        } satisfies Verdict;
      });

      const fiber = yield* settledContentVersionCheck(work, {
        deadlineMs: 50,
        initialDelayMs: 10,
        maximumDelayMs: 10,
      }).pipe(Effect.forkChild);

      yield* TestClock.adjust(100);
      const verdict = yield* Fiber.join(fiber);
      const converges = mismatches <= 5;
      const attempts = Math.min(mismatches + 1, 6);

      expect(gateOutcome(verdict) === "pass").toBe(converges);
      expect(observations).toHaveLength(attempts);
      expect(verdict.counts.attempts).toBe(attempts);
      expect(verdict.counts.failedAttempts).toBe(
        converges ? mismatches : attempts
      );
      expect(
        verdict.provenance?.filter((row) =>
          row.id.startsWith("content-attempt:")
        )
      ).toHaveLength(attempts);
      expect(observations.at(-1)).toBeLessThanOrEqual(50);
    }),
  { arbitrary: { runs: 50 } }
);
