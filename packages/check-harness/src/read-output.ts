import { Effect, Schema } from "effect";

import { VerdictSchema } from "./verdict.js";
import type { Verdict } from "./verdict.js";

export const readOutput = Effect.fn("Check.readOutput")(function* readOutput(
  check: string,
  output: string,
  observedAt: number
) {
  const unknownOutput = {
    attention: "page",
    check,
    control: 0,
    counts: {},
    exitCode: 3,
    observedAt,
    outcome: "errored",
    reason: "CHECK-OUTPUT-UNKNOWN",
    status: "hold",
  } satisfies Verdict;

  const trimmed = output.trim();

  if (trimmed.length === 0 || trimmed.split("\n").length !== 1) {
    return unknownOutput;
  }

  const verdict = yield* Schema.decodeEffect(
    Schema.fromJsonString(VerdictSchema)
  )(trimmed).pipe(Effect.orElseSucceed(() => unknownOutput));

  return verdict.check === check ? verdict : unknownOutput;
});
