import type { Verdict } from "./verdict.js";

export type GateOutcome = "pass" | "fail" | "unknown";

export const gateOutcome = (verdict: Verdict): GateOutcome => {
  if (
    verdict.outcome === "passed" &&
    verdict.exitCode === 0 &&
    verdict.control > 0
  ) {
    return "pass";
  }

  return verdict.outcome === "failed" ? "fail" : "unknown";
};
