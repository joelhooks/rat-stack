import { expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { gateOutcome } from "../src/gate-outcome.js";
import { VerdictSchema } from "../src/verdict.js";

it.prop(
  "only measured success with a zero exit can clear a gate",
  { verdict: VerdictSchema },
  ({ verdict }) => {
    expect(gateOutcome(verdict) === "pass").toBe(
      verdict.outcome === "passed" &&
        verdict.control > 0 &&
        verdict.exitCode === 0
    );
  },
  { arbitrary: { runs: 300 } }
);

it.prop(
  "unknown always fails closed",
  { observedAt: Schema.Natural, reason: Schema.NonEmptyString },
  ({ observedAt, reason }) => {
    expect(
      gateOutcome({
        check: "synthetic",
        control: 0,
        counts: {},
        exitCode: 3,
        observedAt,
        outcome: "errored",
        reason,
        status: "hold",
      })
    ).toBe("unknown");
  }
);
