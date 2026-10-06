import { Effect, Runtime, Schema, Stdio, Stream } from "effect";

import { gateOutcome } from "./gate-outcome.js";
import { VerdictSchema } from "./verdict.js";
import type { Verdict } from "./verdict.js";

export class CheckExit extends Schema.TaggedError<CheckExit>()(
  "@rat-stack/check-harness/CheckExit",
  { exitCode: Schema.Int }
) {
  override get [Runtime.errorExitCode]() {
    return this.exitCode;
  }
  override readonly [Runtime.errorReported] = false;
}

export const emit = Effect.fn("Checks.emit")(function* emit(verdict: Verdict) {
  const json = yield* Schema.encodeEffect(
    Schema.fromJsonString(VerdictSchema, { space: 0 })
  )(verdict);

  const stdio = yield* Stdio.Stdio;

  yield* Stream.make(`${json}\n`).pipe(Stream.run(stdio.stdout()));

  const outcome = gateOutcome(verdict);

  if (outcome !== "pass") {
    return yield* new CheckExit({
      exitCode: outcome === "unknown" ? 3 : verdict.exitCode || 2,
    });
  }

  return 0;
});
