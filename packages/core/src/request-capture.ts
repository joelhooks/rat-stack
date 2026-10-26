import { Effect } from "effect";

import type { IdentityMode, RawEvent } from "./event-sink.js";

export interface RequestCaptureSettings<RB> {
  readonly captureCity?: boolean;
  readonly identityMode: IdentityMode;
  readonly runInBackground: (
    effect: Effect.Effect<void>
  ) => Effect.Effect<void, never, RB>;
}

export interface EventsOptions {
  readonly enabled: boolean;
  readonly id: string;
}

export const eventsOff = (_options: EventsOptions) => Effect.undefined;

export const memoryEventsOff = (_salt: string) =>
  Effect.succeed({
    capture:
      <RB>(_settings: RequestCaptureSettings<RB>) =>
      <A, E, R>(app: Effect.Effect<A, E, R>) =>
        app,
    recorded: Effect.succeed<readonly RawEvent[]>([]),
  });
