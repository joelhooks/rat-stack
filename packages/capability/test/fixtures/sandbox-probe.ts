import { Effect, Schema } from "effect";

import { defineContract } from "../../src/contract.js";
import { implement } from "../../src/implement.js";

export class StorageBudgetExceeded extends Schema.TaggedError<StorageBudgetExceeded>()(
  "StorageBudgetExceeded",
  {
    message: Schema.String,
  }
) {}

const probeContract = defineContract("probe", {
  description: "Exercise sandbox tool boundaries",
  failure: StorageBudgetExceeded,
  input: Schema.Struct({
    fail: Schema.optional(Schema.Boolean),
    value: Schema.Int,
  }),
  output: Schema.Int,
});

export const probe = implement(probeContract, ({ fail, value }) =>
  fail === true
    ? Effect.fail(
        new StorageBudgetExceeded({
          message: "The storage statement budget is exhausted",
        })
      )
    : Effect.succeed(value)
);
