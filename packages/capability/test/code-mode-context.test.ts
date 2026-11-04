import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { defineContract } from "../src/contract.js";
import { implement } from "../src/implement.js";
import { invokerFor } from "../src/to-code-mode.js";
import { StorageBudgetExceeded } from "./fixtures/sandbox-probe.js";

class ProgramStorage extends Context.Service<
  ProgramStorage,
  { readonly budget: number; readonly label: string }
>()("test/ProgramStorage") {}

const storageContract = defineContract("storage", {
  description: "Use the captured per-program storage context",
  failure: StorageBudgetExceeded,
  input: Schema.Struct({ statements: Schema.Natural }),
  output: Schema.String,
});

const storage = implement(storageContract, ({ statements }) =>
  Effect.gen(function* useProgramStorage() {
    const context = yield* ProgramStorage;

    if (statements > context.budget) {
      return yield* new StorageBudgetExceeded({
        message: "The storage statement budget is exhausted",
      });
    }

    return context.label;
  })
);

const primitiveFailureContract = defineContract("primitiveFailure", {
  description: "Fail with a plain string",
  failure: Schema.String,
  input: Schema.Struct({ reason: Schema.String }),
  output: Schema.String,
});

const primitiveFailure = implement(primitiveFailureContract, ({ reason }) =>
  Effect.fail(reason)
);

describe("code-mode Context", () => {
  it.effect.prop(
    "primitive declared failures retain their encoded value and a usable tool diagnostic",
    { reason: Arbitrary.schema(Schema.String) },
    ({ reason }) =>
      Effect.gen(function* invokePrimitiveFailure() {
        const invoke = yield* invokerFor([primitiveFailure]);
        const outcome = yield* invoke("primitiveFailure", { reason });

        if (outcome.ok) {
          return yield* Effect.die(new Error("primitiveFailure must fail."));
        }

        expect(outcome.error).toBe(reason);
        expect(outcome.diagnostic?.kind).toBe("ToolFailure");
        expect(outcome.diagnostic?.message).toMatch(/\S/u);

        return yield* Effect.void;
      })
  );

  it.effect.prop(
    "each invoker keeps its captured service and declared storage budget failure",
    {
      budget: Arbitrary.schema(
        Schema.Natural.check(Schema.isLessThanOrEqualTo(100))
      ),
      label: Arbitrary.schema(Schema.String),
    },
    ({ budget, label }) =>
      Effect.gen(function* preservesProgramContext() {
        const first = yield* invokerFor([storage]).pipe(
          Effect.provideService(ProgramStorage, { budget, label })
        );

        const second = yield* invokerFor([storage]).pipe(
          Effect.provideService(ProgramStorage, {
            budget: budget + 1,
            label: `${label}:second`,
          })
        );

        expect(yield* first("storage", { statements: budget })).toEqual({
          ok: true,
          value: label,
        });
        expect(yield* second("storage", { statements: budget + 1 })).toEqual({
          ok: true,
          value: `${label}:second`,
        });
        expect(
          yield* first("storage", { statements: budget + 1 })
        ).toMatchObject({
          diagnostic: {
            kind: "ToolFailure",
            message: "The storage statement budget is exhausted",
            tag: "StorageBudgetExceeded",
          },
          error: yield* Schema.encodeEffect(StorageBudgetExceeded)(
            new StorageBudgetExceeded({
              message: "The storage statement budget is exhausted",
            })
          ),
          ok: false,
        });
      })
  );
});
