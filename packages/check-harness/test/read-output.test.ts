import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { nextMove } from "../src/next-move.js";
import { readOutput } from "../src/read-output.js";
import type { Verdict } from "../src/verdict.js";

const read = (verdict: Verdict) =>
  readOutput("synthetic", JSON.stringify(verdict), 15);

describe("check process output", () => {
  it.effect(
    "silent, invalid, duplicate and wrong-check output becomes paging UNKNOWN, never clearance",
    () =>
      Effect.gen(function* test() {
        const green = {
          check: "synthetic",
          control: 1,
          counts: {},
          exitCode: 0,
          observedAt: 12,
          outcome: "passed",
          reason: "GATE-TIME",
          status: "green",
        };

        for (const output of [
          "",
          "  \n",
          "not-json",
          JSON.stringify({ ...green, check: "different-check" }),
          `${JSON.stringify(green)}\n${JSON.stringify(green)}`,
        ]) {
          const result = yield* readOutput("synthetic", output, 15);
          expect(result.outcome).toBe("errored");
          expect(result.reason).toBe("CHECK-OUTPUT-UNKNOWN");
          expect(result.attention).toBe("page");
          expect(result.control).toBe(0);
          expect(result.exitCode).toBe(3);
        }

        const final = yield* readOutput(
          "synthetic",
          `${JSON.stringify(green)}\n`,
          15
        );

        expect(final.reason).toBe("GATE-TIME");
        expect(final.outcome).toBe("passed");
        expect(final.attention).toBeUndefined();
      })
  );

  it.effect(
    "a verdict carrying attention stops polling even when it is not-settled",
    () =>
      Effect.gen(function* test() {
        const waiting: Verdict = {
          check: "synthetic",
          control: 0,
          counts: {},
          exitCode: 1,
          observedAt: 12,
          outcome: "not-settled",
          reason: "HEALTH-RETRY-PENDING",
          status: "hold",
        };

        expect(nextMove(yield* read(waiting))).toBe("repoll");

        expect(
          nextMove(
            yield* read({
              ...waiting,
              attention: "owner",
              reason: "PLATFORM-ACTOR-CAP",
            })
          )
        ).toBe("wake-owner");

        expect(nextMove(yield* readOutput("synthetic", "", 15))).toBe(
          "wake-owner"
        );

        expect(
          nextMove(
            yield* read({ ...waiting, outcome: "passed", status: "green" })
          )
        ).toBe("stop");
      })
  );
});
