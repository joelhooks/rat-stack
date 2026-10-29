import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { loadLearnerImplementation } from "../src/learner-loader.js";

it.effect("reports a failed request-time learner chunk as LearnError", () =>
  Effect.gen(function* reportLearnerLoadFailure() {
    const failure = yield* Effect.flip(
      loadLearnerImplementation(
        Promise.reject(new Error("learner chunk unavailable"))
      )
    );

    expect(failure._tag).toBe("LearnError");
    expect(failure.id).toBe("learner");
    expect(failure.reason).toContain("learner chunk unavailable");
  })
);
