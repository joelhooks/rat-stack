import { Effect } from "effect";

import type { RawEvent } from "./event-sink.js";
import type {
  EventsOptions,
  RequestCaptureSettings,
} from "./request-capture.js";

export const events = (_options: EventsOptions) => Effect.undefined;

export const memoryEvents = (_salt: string) =>
  Effect.succeed({
    capture:
      <RB>(_settings: RequestCaptureSettings<RB>) =>
      <A, E, R>(app: Effect.Effect<A, E, R>) =>
        app,
    recorded: Effect.succeed<readonly RawEvent[]>([]),
  });
