import { expect } from "@effect/vitest";
import { Effect } from "effect";

import type { ExecuteResult } from "../../src/to-code-mode.js";

export const checkSandboxConformance = <R>(
  execute: (code: string) => Effect.Effect<typeof ExecuteResult.Type, never, R>
) =>
  Effect.gen(function* sandboxConformance() {
    const success = yield* execute(
      'console.log("start"); return await tools.probe({ value: 7 });'
    );

    expect(success).toMatchObject({
      diagnostic: null,
      logs: ["log: start"],
      result: 7,
      toolCalls: ["probe"],
    });

    const failure = yield* execute(
      "await tools.probe({ value: 1 }); return await tools.probe({ value: 2, fail: true });"
    );

    expect(failure).toMatchObject({
      diagnostic: {
        kind: "ToolFailure",
        message: "The storage statement budget is exhausted",
        tag: "StorageBudgetExceeded",
      },
      result: null,
      toolCalls: ["probe", "probe"],
    });

    const invalid = yield* execute(
      'return await tools.probe({ value: "private-input" });'
    );

    expect(invalid).toMatchObject({
      diagnostic: { kind: "InvalidToolInput", tag: "InvalidInput" },
      result: null,
      toolCalls: ["probe"],
    });
    expect(invalid.diagnostic?.message).not.toContain("private-input");

    const program = yield* execute(
      'await tools.probe({ value: 1 }); console.log("before"); throw new Error("program failure");'
    );

    expect(program).toMatchObject({
      diagnostic: { kind: "ExecutionFailure", message: "program failure" },
      logs: ["log: before"],
      result: null,
      toolCalls: ["probe"],
    });

    const parse = yield* execute("return (");
    expect(parse).toMatchObject({
      diagnostic: { kind: "ParseError" },
      result: null,
      toolCalls: [],
    });
  });

export const checkSandboxLimits = <R>(
  execute: (code: string) => Effect.Effect<typeof ExecuteResult.Type, never, R>
) =>
  Effect.gen(function* sandboxLimitConformance() {
    const calls = yield* execute(
      "await tools.probe({ value: 1 }); await tools.probe({ value: 2 }); return await tools.probe({ value: 3 });"
    );

    expect(calls).toMatchObject({
      diagnostic: { kind: "ToolCallLimitExceeded" },
      result: null,
      toolCalls: ["probe", "probe"],
    });

    const output = yield* execute(
      'console.log("😀".repeat(100)); return "é".repeat(1000);'
    );

    const encoder = new TextEncoder();

    const contentBytes =
      (output.result === null
        ? 0
        : encoder.encode(JSON.stringify(output.result)).length) +
      output.logs.reduce((sum, log) => sum + encoder.encode(log).length, 0);

    expect(contentBytes).toBeLessThanOrEqual(128);
    expect(output).toMatchObject({
      diagnostic: null,
      toolCalls: [],
      truncated: true,
    });

    const failure = yield* execute(
      'console.log("before".repeat(100)); return await tools.probe({ value: 1, fail: true });'
    );

    expect(failure).toMatchObject({
      diagnostic: { kind: "ToolFailure", tag: "StorageBudgetExceeded" },
      result: null,
      toolCalls: ["probe"],
      truncated: true,
    });
  });

export const checkSandboxConcurrency = <R>(
  execute: (code: string) => Effect.Effect<typeof ExecuteResult.Type, never, R>
) =>
  Effect.gen(function* sandboxConcurrencyConformance() {
    yield* execute("return await tools.probeMetrics({ reset: true });");

    const parallel = yield* execute(
      "return await Promise.all(Array.from({ length: 24 }, (_, value) => tools.probe({ value, wait: 20 })));"
    );

    expect(parallel).toMatchObject({
      diagnostic: null,
      result: Array.from({ length: 24 }, (_, value) => value),
      toolCalls: Array.from({ length: 24 }, () => "probe"),
    });

    const metrics = yield* execute("return await tools.probeMetrics({});");
    expect(metrics.result).toEqual({ active: 0, peak: 8 });
  });
