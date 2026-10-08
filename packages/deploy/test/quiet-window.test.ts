import { expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";

import {
  decideQuietWindow,
  QuietWindowSchema,
  quietWindowEnd,
} from "../src/quiet-window.js";
import type { QuietWindow } from "../src/quiet-window.js";

const minuteMs = 60_000;

const dayMinutes = 1440;

const Minute = Schema.Int.check(
  Schema.isBetween({ maximum: dayMinutes - 1, minimum: 0 })
);

const clockTime = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

const GeneratedWindow = Schema.Struct({
  end: Minute,
  hourly: Schema.Boolean,
  start: Minute,
});

interface MinuteWindow {
  readonly end: number;
  readonly hourly: boolean;
  readonly start: number;
}

const normalized = (window: MinuteWindow): MinuteWindow =>
  window.hourly
    ? { end: window.end % 60, hourly: true, start: window.start % 60 }
    : window;

const quietWindow = (window: MinuteWindow): QuietWindow =>
  window.hourly
    ? {
        end: `:${String(window.end).padStart(2, "0")}`,
        start: `:${String(window.start).padStart(2, "0")}`,
      }
    : { end: clockTime(window.end), start: clockTime(window.start) };

const minutesOf = (window: MinuteWindow) => {
  const minutes = new Set<number>();
  const period = window.hourly ? 60 : dayMinutes;

  for (let base = 0; base < dayMinutes; base += period) {
    for (
      let minute = window.start;
      minute !== window.end;
      minute = (minute + 1) % period
    ) {
      minutes.add(base + minute);
    }
  }

  return minutes;
};

const simulatedEnd = (windows: readonly MinuteWindow[], now: number) => {
  const minute = Math.floor(now / minuteMs);

  const ends = windows.flatMap((window) => {
    const covered = minutesOf(window);

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
    const usable = generated
      .map(normalized)
      .filter((window) => window.start !== window.end);

    const windows = usable.map(quietWindow);

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
  ({ maxWaitMs, offsetMs, window: generated }) => {
    const window = normalized(generated);

    if (window.start === window.end) {
      return;
    }

    const windows = [quietWindow(window)];

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

const WindowTime = Schema.Union([
  Schema.String,
  Schema.Literals([
    ":00",
    ":29",
    ":31",
    ":59",
    "00:29",
    "15:30",
    "23:59",
    "24:00",
    ":60",
  ]),
]);

it.prop(
  "window lists parse only when both times share one form and differ",
  { end: WindowTime, start: WindowTime },
  ({ end, start }) => {
    const daily = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
    const hourly = /^:[0-5]\d$/u;

    const sameForm =
      (daily.test(start) && daily.test(end)) ||
      (hourly.test(start) && hourly.test(end));

    expect(Schema.is(QuietWindowSchema)({ end, start })).toBe(
      sameForm && start !== end
    );
  }
);
