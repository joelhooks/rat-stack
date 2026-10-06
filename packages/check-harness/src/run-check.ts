import { Cause, Clock, Effect, Schema } from "effect";

import { VerdictSchema } from "./verdict.js";
import type { Verdict } from "./verdict.js";

export const runCheck = <E, R>(
  check: string,
  work: Effect.Effect<unknown, E, R>
): Effect.Effect<Verdict, never, R> =>
  work.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(VerdictSchema)),
    Effect.catchCause((cause) =>
      Effect.gen(function* erroredVerdict() {
        if (Cause.hasInterrupts(cause)) {
          return yield* Effect.interrupt;
        }

        return {
          check,
          control: 0,
          counts: {},
          exitCode: 3,
          observedAt: yield* Clock.currentTimeMillis,
          outcome: "errored",
          reason: Cause.hasDies(cause) ? "check-crashed" : "check-errored",
          status: "hold",
        } satisfies Verdict;
      })
    )
  );
