import { expect, it } from "@effect/vitest";
import { gateOutcome } from "@rat-stack/check-harness";
import type { Verdict } from "@rat-stack/check-harness";
import { Clock, Effect, Fiber, Option, Schema } from "effect";
import { TestClock } from "effect/testing";

import { settledContentVersionCheck } from "../src/checks.js";
import { settledWorkerVersion } from "../src/worker-version-readback.js";

const ObservationKindSchema = Schema.Literals([
  "mismatch",
  "pass",
  "other",
  "timeout",
]);

type Kind = typeof ObservationKindSchema.Type;

const Observations = Schema.Array(ObservationKindSchema).check(
  Schema.isMaxLength(14)
);

const between = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ maximum, minimum }));

const OptionsSchema = Schema.Struct({
  deadlineMs: between(0, 120),
  initialDelayMs: between(1, 20),
  maximumDelayMs: between(1, 40),
});

type Options = typeof OptionsSchema.Type;

interface Simulation {
  readonly attemptStarts: readonly number[];
  readonly durationMs: number;
  readonly kinds: readonly Kind[];
}

const simulate = (
  sequence: readonly Kind[],
  options: Options,
  settles: (kind: Kind) => boolean
): Simulation => {
  const attemptStarts: number[] = [];
  const kinds: Kind[] = [];
  let elapsed = 0;

  for (;;) {
    const kind = sequence[kinds.length] ?? "mismatch";
    attemptStarts.push(elapsed);
    kinds.push(kind);

    if (kind === "timeout") {
      elapsed += Math.max(1, Math.max(0, options.deadlineMs - elapsed));
    }

    if (settles(kind) || elapsed >= options.deadlineMs) {
      return { attemptStarts, durationMs: elapsed, kinds };
    }

    elapsed += Math.min(
      options.maximumDelayMs,
      options.initialDelayMs * 2 ** (kinds.length - 1),
      options.deadlineMs - elapsed
    );
  }
};

const verdictBodies = {
  mismatch: {
    control: 1,
    exitCode: 2,
    outcome: "failed",
    reason: "content-version-mismatch",
    status: "red",
  },
  other: {
    control: 0,
    exitCode: 3,
    outcome: "errored",
    reason: "content-version-header-missing",
    status: "hold",
  },
  pass: {
    control: 1,
    exitCode: 0,
    outcome: "passed",
    reason: "content-version-confirmed",
    status: "green",
  },
} as const;

const verdictFor = (kind: keyof typeof verdictBodies, observedAt: number) =>
  ({
    check: "content-version:/",
    counts: { observed: 1 },
    observedAt,
    ...verdictBodies[kind],
  }) satisfies Verdict;

it.effect.prop(
  "content-version polling follows the reference model for attempts, delays, deadline and verdict",
  { options: OptionsSchema, sequence: Observations },
  ({ options, sequence }) =>
    Effect.gen(function* model() {
      const starts: number[] = [];
      const seen: Kind[] = [];

      const work = Effect.gen(function* observe() {
        const now = yield* Clock.currentTimeMillis;
        const kind = sequence[starts.length] ?? "mismatch";
        starts.push(now);
        seen.push(kind);

        if (kind === "timeout") {
          return yield* Effect.never;
        }

        return verdictFor(kind, now);
      });

      const fiber = yield* settledContentVersionCheck(work, options).pipe(
        Effect.forkChild
      );

      yield* TestClock.adjust(1_000_000);
      const verdict = yield* Fiber.join(fiber);

      const expected = simulate(
        sequence,
        options,
        (kind) => kind !== "mismatch"
      );

      const last = expected.kinds.at(-1);

      expect(starts).toStrictEqual(expected.attemptStarts);
      expect(seen).toStrictEqual(expected.kinds);
      expect(verdict.counts.attempts).toBe(expected.kinds.length);
      expect(verdict.counts.durationMs).toBe(expected.durationMs);
      expect(verdict.counts.deadlineMs).toBe(options.deadlineMs);
      expect(verdict.counts.failedAttempts).toBe(
        expected.kinds.length - (last === "pass" ? 1 : 0)
      );
      expect(gateOutcome(verdict) === "pass").toBe(last === "pass");
      expect(verdict.reason).toBe(
        {
          mismatch: "content-version-mismatch",
          other: "content-version-header-missing",
          pass: "content-version-confirmed",
          timeout: "check-errored",
        }[last ?? "mismatch"]
      );
      expect(
        verdict.provenance?.filter((row) =>
          row.id.startsWith("content-attempt:")
        )
      ).toHaveLength(expected.kinds.length);
    }),
  { arbitrary: { runs: 100 } }
);

it.effect.prop(
  "worker version polling follows the reference model for attempts, delays, deadline and verdict",
  { changed: Schema.Boolean, options: OptionsSchema, sequence: Observations },
  ({ changed, options, sequence }) =>
    Effect.gen(function* model() {
      const starts: number[] = [];

      const read = Effect.gen(function* observe() {
        const now = yield* Clock.currentTimeMillis;
        const kind = sequence[starts.length] ?? "mismatch";
        starts.push(now);

        if (kind === "timeout") {
          return yield* Effect.never;
        }

        if (kind === "pass") {
          return Option.some("new-version");
        }

        return kind === "other"
          ? Option.some("old-version")
          : Option.none<string>();
      });

      const fiber = yield* settledWorkerVersion(
        read,
        "fixture-script",
        "old-version",
        changed,
        options
      ).pipe(Effect.forkChild);

      yield* TestClock.adjust(1_000_000);
      const check = yield* Fiber.join(fiber);

      const settles = (kind: Kind) =>
        kind === "pass" || (kind === "other" && !changed);

      const expected = simulate(sequence, options, settles);
      const last = expected.kinds.at(-1) ?? "mismatch";
      const passed = settles(last);

      expect(starts).toStrictEqual(expected.attemptStarts);
      expect(check.counts.attempts).toBe(expected.kinds.length);
      expect(check.counts.durationMs).toBe(expected.durationMs);
      expect(check.counts.deadlineMs).toBe(options.deadlineMs);
      expect(check.counts.failedAttempts).toBe(
        expected.kinds.length - (passed ? 1 : 0)
      );
      expect(gateOutcome(check) === "pass").toBe(passed);
      expect(check.reason).toBe(
        passed
          ? "worker-live-version-confirmed"
          : "worker-live-version-deadline-exhausted"
      );
      expect(check.provenance).toHaveLength(expected.kinds.length);
    }),
  { arbitrary: { runs: 100 } }
);
