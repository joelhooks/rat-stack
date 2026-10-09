import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { SandboxError } from "../src/sandbox-error.js";
import { boundOutput } from "../src/sandbox-limits.js";
import { sandboxRunner } from "../src/sandbox-result.js";
import type { Invoke } from "../src/sandbox-service.js";

const byteBudget = Arbitrary.schema(
  Schema.Natural.check(Schema.isLessThanOrEqualTo(256))
);

const logs = Arbitrary.schema(
  Schema.Array(Schema.String).check(Schema.isMaxLength(8))
);

describe("sandbox limits", () => {
  it.prop(
    "UTF-8 result and log content stays within budget without changing audit or diagnostics",
    {
      budget: byteBudget,
      logs,
      result: Arbitrary.schema(Schema.Json),
    },
    ({ budget, logs: messages, result }) => {
      const diagnostic = {
        kind: "ToolFailure",
        message: "safe failure",
        tag: "BudgetExceeded",
      } as const;

      const bounded = boundOutput(
        { diagnostic, logs: messages, result, toolCalls: ["first", "second"] },
        budget
      );

      const encoder = new TextEncoder();

      const resultSize =
        bounded.result === null
          ? 0
          : encoder.encode(JSON.stringify(bounded.result)).length;

      const logSize = bounded.logs.reduce(
        (sum, log) => sum + encoder.encode(log).length,
        0
      );

      const originalSize =
        (result === null ? 0 : encoder.encode(JSON.stringify(result)).length) +
        messages.reduce((sum, log) => sum + encoder.encode(log).length, 0);

      expect(resultSize + logSize).toBeLessThanOrEqual(budget);
      expect(bounded.diagnostic).toEqual(diagnostic);
      expect(bounded.toolCalls).toEqual(["first", "second"]);
      expect(bounded.truncated).toBe(originalSize > budget);
    }
  );

  it.effect.prop(
    "only the admitted prefix reaches handlers and remains on limit failure",
    {
      budget: Arbitrary.schema(
        Schema.Natural.check(Schema.isLessThanOrEqualTo(8))
      ),
      count: Arbitrary.schema(
        Schema.Natural.check(Schema.isLessThanOrEqualTo(16))
      ),
    },
    ({ budget, count }) =>
      Effect.gen(function* countsAdmissions() {
        const called: string[] = [];

        const names = Array.from(
          { length: count },
          (_, index) => `call${index}`
        );

        const invoke: Invoke = (name) =>
          Effect.sync(() => {
            called.push(name);

            return { ok: true, value: null };
          });

        const run = sandboxRunner(
          (_code, dispatch) =>
            Effect.gen(function* executePlan() {
              for (const name of names) {
                const outcome = yield* dispatch(name, {});

                if (!outcome.ok) {
                  return yield* new SandboxError({
                    diagnostic: outcome.diagnostic,
                    logs: [],
                    message: "limit",
                    reason: "threw",
                  });
                }
              }

              return { logs: [], result: null };
            }),
          { maxToolCalls: budget }
        );

        const result = yield* run("", invoke, names);

        expect(called).toEqual(names.slice(0, budget));
        expect(result.toolCalls).toEqual(called);
        expect(result.diagnostic?.kind).toBe(
          count > budget ? "ToolCallLimitExceeded" : undefined
        );
      })
  );

  it("zero output budget removes content and marks truncation", () => {
    expect(
      boundOutput({ logs: ["😀"], result: "value", toolCalls: ["write"] }, 0)
    ).toEqual({
      logs: [],
      result: null,
      toolCalls: ["write"],
      truncated: true,
    });
  });
});
