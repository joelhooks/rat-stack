import { expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";

import { decideQuietWindow, quietWindowEnd } from "../src/quiet-window.js";
import type { QuietWindow } from "../src/quiet-window.js";

const minuteMs = 60_000;

const dayMinutes = 1440;

const Minute = Schema.Int.check(
  Schema.isBetween({ maximum: dayMinutes - 1, minimum: 0 })
);

const clockTime = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

const GeneratedWindow = Schema.Struct({ end: Minute, start: Minute });

const minutesOf = (start: number, end: number) => {
  const minutes = new Set<number>();

  for (let minute = start; minute !== end; minute = (minute + 1) % dayMinutes) {
    minutes.add(minute);
  }

  return minutes;
};

const simulatedEnd = (
  windows: readonly { readonly end: number; readonly start: number }[],
  now: number
) => {
  const minute = Math.floor(now / minuteMs);

  const ends = windows.flatMap((window) => {
    const covered = minutesOf(window.start, window.end);

    if (!covered.has(minute % dayMinutes)) {
      return [];
    }

    let next = minute;

    while (covered.has(next % dayMinutes)) {
      next += 1;
    }

    return [next * minuteMs];
  });

  return ends.length === 0 ? Option.none() : Option.some(Math.max(...ends));
};

it.prop(
  "a deploy time inside any window waits until that window's end, minute by minute",
  {
    day: Schema.Int.check(Schema.isBetween({ maximum: 20_000, minimum: 0 })),
    generated: Schema.Array(GeneratedWindow).check(Schema.isMaxLength(5)),
    offsetMs: Schema.Int.check(
      Schema.isBetween({ maximum: 86_399_999, minimum: 0 })
    ),
  },
  ({ day, generated, offsetMs }) => {
    const usable = generated.filter((window) => window.start !== window.end);

    const windows: QuietWindow[] = usable.map((window) => ({
      end: clockTime(window.end),
      start: clockTime(window.start),
    }));

    const now = day * 86_400_000 + offsetMs;

    expect(quietWindowEnd(windows, now)).toStrictEqual(
      simulatedEnd(usable, now)
    );
  },
  { arbitrary: { runs: 1000 } }
);

it.prop(
  "the driver waits only when the window ends inside the wait bound",
  {
    maxWaitMs: Schema.Int.check(
      Schema.isBetween({ maximum: 3_600_000, minimum: 0 })
    ),
    offsetMs: Schema.Int.check(
      Schema.isBetween({ maximum: 86_399_999, minimum: 0 })
    ),
    window: GeneratedWindow,
  },
  ({ maxWaitMs, offsetMs, window }) => {
    if (window.start === window.end) {
      return;
    }

    const windows = [
      { end: clockTime(window.end), start: clockTime(window.start) },
    ];

    const decision = decideQuietWindow(
      { maxWaitMs, windows },
      offsetMs,
      offsetMs + maxWaitMs
    );

    const end = simulatedEnd([window], offsetMs);

    if (Option.isNone(end)) {
      expect(decision.kind).toBe("clear");
    } else if (end.value - offsetMs <= maxWaitMs) {
      expect(decision).toStrictEqual({
        deadline: offsetMs + maxWaitMs,
        kind: "wait",
        until: end.value,
      });
    } else {
      expect(decision.kind).toBe("refused");
    }
  },
  { arbitrary: { runs: 500 } }
);
