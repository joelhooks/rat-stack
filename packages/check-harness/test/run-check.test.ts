import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { runCheck } from "../src/run-check.js";
import { VerdictSchema } from "../src/verdict.js";

const measured = {
  check: "synthetic",
  control: 1,
  counts: { observed: 1 },
  observedAt: 0,
  reason: "synthetic-measurement",
};

class FixtureFailure extends Schema.TaggedError<FixtureFailure>()(
  "FixtureFailure",
  { privateDetail: Schema.String }
) {}

describe("check harness outcomes", () => {
  it.effect("preserves completed measurements and exact legacy exits", () =>
    Effect.gen(function* test() {
      const measurements = [
        { ...measured, exitCode: 0, outcome: "passed", status: "green" },
        { ...measured, exitCode: 0, outcome: "not-settled", status: "amber" },
        { ...measured, exitCode: 2, outcome: "failed", status: "red" },
      ];

      for (const measurement of measurements) {
        const verdict = yield* runCheck(
          "synthetic",
          Effect.succeed(measurement)
        );

        expect(verdict.outcome).toBe(measurement.outcome);
        expect(verdict.exitCode).toBe(measurement.exitCode);
        expect(verdict.counts.observed).toBe(1);
      }
    })
  );

  it.effect("typed failure cannot become a measured failure or success", () =>
    Effect.gen(function* test() {
      const verdict = yield* runCheck(
        "synthetic",
        Effect.fail(
          new FixtureFailure({ privateDetail: "synthetic-private-value" })
        )
      );

      expect(verdict.outcome).toBe("errored");
      expect(verdict.status).toBe("hold");
      expect(verdict.control).toBe(0);
      expect(verdict.exitCode).toBe(3);
      expect(verdict.reason).toBe("check-errored");
      expect(JSON.stringify(verdict)).not.toContain("synthetic-private-value");
    })
  );

  it.effect(
    "a defect becomes sanitized crashed evidence, never red or green",
    () =>
      Effect.gen(function* test() {
        const verdict = yield* runCheck(
          "synthetic",
          Effect.die("synthetic-private-defect")
        );

        expect(verdict.outcome).toBe("errored");
        expect(verdict.status).toBe("hold");
        expect(verdict.control).toBe(0);
        expect(verdict.exitCode).toBe(3);
        expect(verdict.reason).toBe("check-crashed");
        expect(JSON.stringify(verdict)).not.toContain(
          "synthetic-private-defect"
        );
      })
  );

  it.effect("inconsistent claimed outcomes fail closed at the boundary", () =>
    Effect.gen(function* test() {
      for (const status of ["green", "red", "hold"]) {
        const verdict = yield* runCheck(
          "synthetic",
          Effect.succeed({
            ...measured,
            control: 1,
            exitCode: 0,
            outcome: "errored",
            status,
          })
        );

        expect(verdict.outcome).toBe("errored");
        expect(verdict.control).toBe(0);
        expect(verdict.exitCode).toBe(3);
        expect(verdict.reason).toBe("check-errored");
      }

      const verdict = yield* runCheck(
        "synthetic",
        Effect.succeed({ ...measured, exitCode: 0, status: "green" })
      );

      expect(verdict.outcome).toBe("errored");
      expect(Schema.is(VerdictSchema)(verdict)).toBe(true);
    })
  );
});
