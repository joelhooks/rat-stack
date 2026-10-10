import type { SandboxRun } from "./sandbox-port.js";

export { resolveLimits } from "./sandbox-limits-schema.js";

export type { SandboxLimits } from "./sandbox-limits-schema.js";

const encoder = new TextEncoder();

const bytes = (text: string): number => encoder.encode(text).length;

const prefix = (text: string, budget: number, json: boolean): string => {
  let remaining = Math.max(0, budget - (json ? 2 : 0));
  let result = "";

  for (const character of text) {
    const cost = json ? bytes(JSON.stringify(character)) - 2 : bytes(character);

    if (cost > remaining) {
      break;
    }

    result += character;
    remaining -= cost;
  }

  return result;
};

export const boundOutput = (run: SandboxRun, budget?: number): SandboxRun => {
  if (budget === undefined) {
    return { ...run, truncated: run.truncated ?? false };
  }

  const encoded = JSON.stringify(run.result) ?? "null";
  let { result } = run;
  let used = result === null ? 0 : bytes(encoded);
  let truncated = run.truncated ?? false;

  if (used > budget) {
    result = budget < 2 ? null : prefix(encoded, budget, true);
    used = result === null ? 0 : bytes(JSON.stringify(result));
    truncated = true;
  }

  const logs: string[] = [];

  for (const log of run.logs) {
    const kept = prefix(log, Math.max(0, budget - used), false);

    if (kept !== "" || log === "") {
      logs.push(kept);
    }

    used += bytes(kept);

    if (kept !== log) {
      truncated = true;
      break;
    }
  }

  return { ...run, logs, result, truncated };
};
