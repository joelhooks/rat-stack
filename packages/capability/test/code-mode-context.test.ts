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

describe("code-mode Context", () => {
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
