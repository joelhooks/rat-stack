import { expect, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  maxWatchObservations,
  nextWatchEvidence,
  watchCompletionFailureReason,
  watchFailureReason,
} from "../src/watch.js";
import type { WatchEvidence } from "../src/watch.js";

const observation = (route: number, status: number, observedAt = 0) => ({
  accept: "text/html",
  body: "",
  content: true,
  observedAt,
  route: `/r/${route}`,
  status,
});

it.prop(
  "the remaining observation ceiling includes only cycles that can start before the deadline",
  {
    intervalMs: Schema.Int.check(
      Schema.isBetween({ maximum: 200, minimum: 1 })
    ),
    observed: Schema.Int.check(Schema.isBetween({ maximum: 300, minimum: 0 })),
    probes: Schema.Int.check(Schema.isBetween({ maximum: 40, minimum: 2 })),
    remainingMs: Schema.Int.check(
      Schema.isBetween({ maximum: 2000, minimum: 0 })
    ),
  },
  ({ observed, remainingMs, intervalMs, probes }) => {
    let expected = observed;

    for (let start = intervalMs; start < remainingMs; start += intervalMs) {
      expected += probes;
    }

    expect(
      maxWatchObservations({
        intervalMs,
        observed,
        probesPerCycle: probes,
        remainingMs,
      })
    ).toBe(expected);
  },
  { arbitrary: { runs: 1000 } }
);

it("an unpaced watch has no finite future ceiling until its deadline", () => {
  expect(
    maxWatchObservations({
      intervalMs: 0,
      observed: 100,
      probesPerCycle: 12,
      remainingMs: 1,
    })
  ).toBe(Number.POSITIVE_INFINITY);
  expect(
    maxWatchObservations({
      intervalMs: 0,
      observed: 100,
      probesPerCycle: 12,
      remainingMs: 0,
    })
  ).toBe(100);
});

const completed = (blips: number) =>
  nextWatchEvidence(
    { cycles: 0, observations: [], routes: [] },
    Array.from({ length: 100 }, (_, index) =>
      observation(index, index < blips ? 0 : 200)
    )
  );

it("the completed-watch policy rejects six percent blips and permits four percent", () => {
  expect(watchCompletionFailureReason(completed(6))).toBe(
    "transport-blip-ratio"
  );
  expect(watchCompletionFailureReason(completed(4))).toBeUndefined();
});

it.prop(
  "alternating outage histories fail before the deadline exactly when no healthy continuation can recover the ratio",
  {
    cycles: Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 20 })),
    intervalMs: Schema.Int.check(
      Schema.isBetween({ maximum: 200, minimum: 1 })
    ),
    probes: Schema.Int.check(Schema.isBetween({ maximum: 30, minimum: 2 })),
  },
  ({ cycles, intervalMs, probes }) => {
    const deadline = (cycles + 1) * intervalMs;
    const possibleObservations = 1 + (cycles + 1) * probes;

    let evidence: WatchEvidence = {
      cycles: 0,
      observations: [observation(0, 200)],
      routes: [],
    };

    let failedAt: number | undefined;

    for (let cycle = 0; cycle < cycles; cycle += 1) {
      const now = cycle * intervalMs;

      const rows = Array.from({ length: probes }, (_, route) =>
        observation(route, cycle % 2 === 0 ? 0 : 200, now)
      );

      const maximum = maxWatchObservations({
        intervalMs,
        observed: evidence.observations.length + rows.length,
        probesPerCycle: probes,
        remainingMs: deadline - now,
      });

      evidence = nextWatchEvidence(evidence, rows, maximum);
      const blips = Math.ceil((cycle + 1) / 2) * probes;
      const irrecoverable = blips / possibleObservations > 0.05;

      expect(maximum).toBe(possibleObservations);
      expect(watchFailureReason(evidence)).toBe(
        irrecoverable ? "transport-blip-ratio" : undefined
      );

      if (irrecoverable) {
        failedAt = now;
        break;
      }
    }

    expect(failedAt).toBeDefined();
    expect(failedAt ?? deadline).toBeLessThan(deadline);
  },
  { arbitrary: { runs: 1000 } }
);
