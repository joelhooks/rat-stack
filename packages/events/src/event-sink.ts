import { Context } from "effect";
import type { Effect } from "effect";

import type { EventSinkError } from "./event-sink-error.js";
import type { RawEvent } from "./schemas.js";

export class EventSink extends Context.Service<
  EventSink,
  {
    readonly send: (
      events: readonly RawEvent[]
    ) => Effect.Effect<void, EventSinkError>;
  }
>()("@rat-stack/events/EventSink") {}
