import { expect } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { ExecuteError } from "../../src/execute-error.js";
import type { ExecuteResult } from "../../src/to-code-mode.js";

type Execute<R, E> = (
  code: string
) => Effect.Effect<typeof ExecuteResult.Type, E, R>;

export const checkSandboxConformance = <R, E>(execute: Execute<R, E>) =>
  Effect.gen(function* sandboxConformance() {
    const success = yield* execute(
      'console.log("start"); return await tools.probe({ value: 7 });'
    );

    expect(success).toMatchObject({
      logs: ["log: start"],
      result: 7,
      toolCalls: ["probe"],
    });
    expect(success).not.toHaveProperty("diagnostic");

    const failure = yield* execute(
      "await tools.probe({ value: 1 }); return await tools.probe({ value: 2, fail: true });"
    ).pipe(Effect.flip);

    expect(failure).toMatchObject({
      kind: "ToolFailure",
      message: "The storage statement budget is exhausted",
      tag: "StorageBudgetExceeded",
      toolCalls: ["probe", "probe"],
    });

    const invalid = yield* execute(
      'return await tools.probe({ value: "private-input" });'
    ).pipe(Effect.flip);

    expect(invalid).toMatchObject({
      kind: "InvalidToolInput",
      tag: "InvalidInput",
      toolCalls: ["probe"],
    });

    const invalidError =
      yield* Schema.decodeUnknownEffect(ExecuteError)(invalid);

    expect(invalidError.message).not.toContain("private-input");

    const program = yield* execute(
      'await tools.probe({ value: 1 }); console.log("before"); throw new Error("program failure");'
    ).pipe(Effect.flip);

    expect(program).toMatchObject({
      kind: "ExecutionFailure",
      logs: ["log: before"],
      message: "program failure",
      toolCalls: ["probe"],
    });

    const parse = yield* execute("return (").pipe(Effect.flip);
    expect(parse).toMatchObject({
      kind: "ParseError",
      toolCalls: [],
    });

    const network = yield* execute(
      'return await fetch("https://example.com");'
    ).pipe(Effect.flip);

    expect(network).toMatchObject({
      kind: "ExecutionFailure",
      toolCalls: [],
    });
  });

export const checkSandboxLimits = <R, E>(execute: Execute<R, E>) =>
  Effect.gen(function* sandboxLimitConformance() {
    const calls = yield* execute(
      "await tools.probe({ value: 1 }); await tools.probe({ value: 2 }); return await tools.probe({ value: 3 });"
    ).pipe(Effect.flip);

    expect(calls).toMatchObject({
      kind: "ToolCallLimitExceeded",
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
      toolCalls: [],
      truncated: true,
    });

    const failure = yield* execute(
      'console.log("before".repeat(100)); return await tools.probe({ value: 1, fail: true });'
    ).pipe(Effect.flip);

    expect(failure).toMatchObject({
      kind: "ToolFailure",
      tag: "StorageBudgetExceeded",
      toolCalls: ["probe"],
      truncated: true,
    });
  });

export const checkSandboxConcurrency = <R, E>(execute: Execute<R, E>) =>
  Effect.gen(function* sandboxConcurrencyConformance() {
    yield* execute("return await tools.probeMetrics({ reset: true });");

    const parallel = yield* execute(
      "return await Promise.all(Array.from({ length: 24 }, (_, value) => tools.probe({ value, wait: 20 })));"
    );

    expect(parallel).toMatchObject({
      result: Array.from({ length: 24 }, (_, value) => value),
      toolCalls: Array.from({ length: 24 }, () => "probe"),
    });

    const metrics = yield* execute("return await tools.probeMetrics({});");
    expect(metrics.result).toEqual({ active: 0, peak: 8 });
  });
