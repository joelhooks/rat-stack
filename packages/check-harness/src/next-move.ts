import type { Verdict } from "./verdict.js";

export type NextMove = "repoll" | "stop" | "wake-owner";

export const nextMove = (verdict: Verdict): NextMove => {
  if (verdict.attention !== undefined) {
    return "wake-owner";
  }

  return verdict.outcome === "not-settled" ? "repoll" : "stop";
};
