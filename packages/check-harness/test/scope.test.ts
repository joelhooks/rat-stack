import { describe, expect, it } from "@effect/vitest";

import type { CheckRequest } from "../src/request.js";
import { appliesToRequest, bindToRequest } from "../src/scope.js";
import type { Verdict } from "../src/verdict.js";

const request: CheckRequest = {
  attempt: 1,
  candidateVersions: { worker: "version-a" },
  deploymentGeneration: 1,
  head: "a".repeat(40),
  runId: "synthetic-a",
  window: { from: 90, through: 110 },
};

const measurement: Verdict = {
  check: "synthetic",
  control: 1,
  counts: {},
  exitCode: 0,
  observedAt: 100,
  outcome: "passed",
  reason: "synthetic-measured",
  status: "green",
};

describe("check request ownership", () => {
  it("saved evaluation data cannot establish version provenance", () => {
    expect(appliesToRequest(request, measurement)).toBe(false);
    expect(
      appliesToRequest(request, { ...measurement, evaluationOnly: true })
    ).toBe(false);
    const attested = bindToRequest(request, request, measurement);
    expect(appliesToRequest(request, attested)).toBe(true);
  });

  it("a stale A failure never authorizes action on active B", () => {
    const failure: Verdict = {
      ...measurement,
      exitCode: 2,
      outcome: "failed",
      status: "red",
    };

    const a = bindToRequest(request, request, failure);

    const b: CheckRequest = {
      ...request,
      deploymentGeneration: 2,
      head: "b".repeat(40),
      runId: "synthetic-b",
    };

    expect(appliesToRequest(b, a)).toBe(false);
    const refused = bindToRequest(b, request, failure);
    expect(refused.outcome).toBe("not-settled");
    expect(refused.control).toBe(0);
    expect(refused.exitCode).toBe(3);
  });

  it("version set, attempt, generation and window cannot be substituted", () => {
    const attested = bindToRequest(request, request, measurement);

    for (const changed of [
      { ...request, attempt: 2 },
      { ...request, deploymentGeneration: 2 },
      { ...request, candidateVersions: { worker: "version-b" } },
      {
        ...request,
        candidateVersions: { extra: "version-a", worker: "version-a" },
      },
      { ...request, window: { from: 91, through: 110 } },
    ]) {
      expect(appliesToRequest(changed, attested)).toBe(false);
    }

    expect(
      bindToRequest(request, request, { ...measurement, observedAt: 89 })
        .control
    ).toBe(0);
  });

  it("a later live read of the exact closed window remains owned, including a point window", () => {
    for (const scope of [
      request,
      { ...request, window: { from: 110, through: 110 } },
    ]) {
      const attested = bindToRequest(scope, scope, {
        ...measurement,
        observedAt: 111,
      });

      expect(attested.control).toBe(1);
      expect(appliesToRequest(scope, attested)).toBe(true);
    }

    const reversed = { ...request, window: { from: 111, through: 110 } };
    expect(
      bindToRequest(reversed, reversed, { ...measurement, observedAt: 112 })
        .control
    ).toBe(0);
  });
});
