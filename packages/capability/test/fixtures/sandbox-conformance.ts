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
