import { Duration, Effect, Schema } from "effect";

import { defineContract } from "../../src/contract.js";
import { implement } from "../../src/implement.js";
import { ProbeActivity } from "./probe-activity.js";

export { ProbeActivity } from "./probe-activity.js";

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
    wait: Schema.optional(Schema.Natural),
  }),
  output: Schema.Int,
});

export const probe = implement(probeContract, ({ fail, value, wait }) =>
  Effect.gen(function* executeProbe() {
    const activity = yield* ProbeActivity;

    return yield* activity.around(
      Effect.gen(function* probeOutcome() {
        if (fail === true) {
          return yield* new StorageBudgetExceeded({
            message: "The storage statement budget is exhausted",
          });
        }

        if (wait !== undefined) {
          yield* Effect.sleep(Duration.millis(wait));
        }

        return value;
      })
    );
  })
);

const probeMetricsContract = defineContract("probeMetrics", {
  description: "Read or reset sandbox concurrency measurements",
  failure: Schema.Never,
  input: Schema.Struct({ reset: Schema.optional(Schema.Boolean) }),
  output: Schema.Struct({ active: Schema.Int, peak: Schema.Int }),
});

export const probeMetrics = implement(probeMetricsContract, ({ reset }) =>
  ProbeActivity.use((activity) => activity.read(reset ?? false))
);
