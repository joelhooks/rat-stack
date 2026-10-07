import { Clock, Config, Effect, Option, Schema } from "effect";

const minuteMs = 60_000;

const dayMs = 24 * 60 * minuteMs;

const ClockTimeSchema = Schema.String.check(
  Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
).annotate({ description: "UTC time of day as HH:MM" });

export const QuietWindowSchema = Schema.Struct({
  end: ClockTimeSchema,
  start: ClockTimeSchema,
}).check(
  Schema.makeFilter(
    (window) =>
      window.start !== window.end ||
      "a quiet window needs different start and end times"
  )
);

export type QuietWindow = typeof QuietWindowSchema.Type;

export const QuietWindowsSchema = Schema.Array(QuietWindowSchema);

export const quietWindowWaitLimitMs = 3_600_000;

export const quietWindowKeys = [
  "DEPLOY_QUIET_WINDOWS",
  "DEPLOY_QUIET_WINDOW_MAX_WAIT_MS",
] as const;

export const QuietWindowPolicySchema = Schema.Struct({
  maxWaitMs: Schema.Int.check(
    Schema.isBetween({ maximum: quietWindowWaitLimitMs, minimum: 0 })
  ),
  windows: QuietWindowsSchema,
});

export type QuietWindowPolicy = typeof QuietWindowPolicySchema.Type;

export const quietWindowPolicy = Effect.fn("quietWindowPolicy")(
  function* quietWindowPolicy() {
    const maxWaitMs = yield* Config.schema(
      QuietWindowPolicySchema.fields.maxWaitMs,
      "DEPLOY_QUIET_WINDOW_MAX_WAIT_MS"
    ).pipe(Config.withDefault(0));

    const listed = yield* Config.String("DEPLOY_QUIET_WINDOWS").pipe(
      Config.withDefault("")
    );

    const windows =
      listed.trim().length === 0
        ? []
        : yield* Schema.decodeEffect(Schema.fromJsonString(QuietWindowsSchema))(
            listed
          );

    return { maxWaitMs, windows } satisfies QuietWindowPolicy;
  }
);

const minuteOfDay = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

const covers = (window: QuietWindow, minute: number) => {
  const start = minuteOfDay(window.start);
  const end = minuteOfDay(window.end);

  return start < end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
};

const endAfter = (window: QuietWindow, now: number) => {
  const dayStart = now - (now % dayMs);
  const end = dayStart + minuteOfDay(window.end) * minuteMs;

  return end > now ? end : end + dayMs;
};

export const quietWindowEnd = (
  windows: readonly QuietWindow[],
  now: number
): Option.Option<number> => {
  const minute = Math.floor((now % dayMs) / minuteMs);
  const active = windows.filter((window) => covers(window, minute));

  return active.length === 0
    ? Option.none()
    : Option.some(Math.max(...active.map((window) => endAfter(window, now))));
};

export type QuietWindowDecision =
  | { readonly kind: "clear"; readonly deadline: number }
  | {
      readonly kind: "wait";
      readonly deadline: number;
      readonly until: number;
    }
  | { readonly kind: "refused"; readonly reason: string };

export const decideQuietWindow = (
  policy: QuietWindowPolicy,
  now: number,
  deadline: number
): QuietWindowDecision =>
  Option.match(quietWindowEnd(policy.windows, now), {
    onNone: () => ({ deadline, kind: "clear" }),
    onSome: (until) =>
      until <= deadline
        ? { deadline, kind: "wait", until }
        : { kind: "refused", reason: "inside-quiet-window" },
  });

export const readQuietWindow = Effect.fn("readQuietWindow")(
  function* readQuietWindow(deadline: number | undefined) {
    const policy = yield* quietWindowPolicy();
    const now = yield* Clock.currentTimeMillis;

    return decideQuietWindow(policy, now, deadline ?? now + policy.maxWaitMs);
  }
);
