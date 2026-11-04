import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { defineContract } from "../src/contract.js";
import { implement } from "../src/implement.js";
import { SandboxError } from "../src/sandbox-error.js";
import { sandboxRunner } from "../src/sandbox-result.js";
import { invokerFor } from "../src/to-code-mode.js";

class ReadFailed extends Schema.TaggedError<
  ReadFailed,
  { readonly brand: unique symbol }
>()("ReadFailed", {
  message: Schema.String,
}) {}

const readFileContract = defineContract("readFile", {
  description: "Fail with a message that names a host path",
  failure: ReadFailed,
  input: Schema.Struct({ message: Schema.String }),
  output: Schema.String,
});

const readFile = implement(readFileContract, ({ message }) =>
  Effect.fail(new ReadFailed({ message }))
);

const diagnosticCase = {
  padding: Schema.Int.check(Schema.isBetween({ maximum: 1500, minimum: 0 })),
  prefix: Schema.Literals([
    "/Users/",
    "/home/",
    "/private/",
    "/tmp/",
    "/var/folders/",
  ]),
  suffix: Schema.String.check(
    Schema.isPattern(/^[a-z0-9][a-z0-9/._-]{0,39}$/u)
  ),
};

const messageOf = (prefix: string, suffix: string, padding: number) => {
  const syntheticPath = `${prefix}${suffix}`;

  return {
    message: `could not read ${syntheticPath}${padding === 0 ? "" : ` ${"x".repeat(padding)}`}`,
    syntheticPath,
  };
};

const expectModelSafe = (
  message: string | undefined,
  syntheticPath: string
) => {
  expect(message).toContain("could not read");
  expect(message).toContain("<redacted-path>");
  expect(message).not.toContain(syntheticPath);
  expect(message?.length).toBeLessThanOrEqual(512);
};

describe("model-facing diagnostics", () => {
  it.effect.prop(
    "declared tool errors expose useful bounded diagnostics without absolute paths",
    diagnosticCase,
    ({ padding, prefix, suffix }) =>
      Effect.gen(function* invokeFailingTool() {
        const { message, syntheticPath } = messageOf(prefix, suffix, padding);
        const invoke = yield* invokerFor([readFile]);
        const outcome = yield* invoke("readFile", { message });

        if (outcome.ok) {
          return yield* Effect.die(new Error("readFile must fail."));
        }

        expect(outcome.diagnostic?.kind).toBe("ToolFailure");
        expectModelSafe(outcome.diagnostic?.message, syntheticPath);

        return yield* Effect.void;
      })
  );

  it.effect.prop(
    "sandbox program errors expose bounded diagnostics without absolute paths",
    diagnosticCase,
    ({ padding, prefix, suffix }) =>
      Effect.gen(function* runFailingProgram() {
        const { message, syntheticPath } = messageOf(prefix, suffix, padding);

        const run = sandboxRunner(() =>
          Effect.fail(new SandboxError({ logs: [], message, reason: "threw" }))
        );

        const result = yield* run("", () =>
          Effect.succeed({ ok: true, value: null })
        );

        expect(result.diagnostic?.kind).toBe("ExecutionFailure");
        expectModelSafe(result.diagnostic?.message, syntheticPath);
      })
  );
});
