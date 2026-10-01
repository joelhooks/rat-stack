import { Context, Effect, Layer, Ref } from "effect";

import { EventSink } from "./event-sink.js";
import type { RawEvent } from "./schemas.js";
import { VisitorSalt } from "./visitor-salt.js";

export class EventSinkMemory extends Context.Service<
  EventSinkMemory,
  { readonly events: Effect.Effect<readonly RawEvent[]> }
>()("@rat-stack/events/EventSinkMemory") {}

export const memoryEventsLayer = (salt: string) =>
  Layer.unwrap(
    Effect.gen(function* buildMemoryEvents() {
      const recorded = yield* Ref.make<readonly RawEvent[]>([]);

      return Layer.mergeAll(
        Layer.succeed(EventSink, {
          send: (events) => Ref.update(recorded, (all) => [...all, ...events]),
        }),
        Layer.succeed(EventSinkMemory, { events: Ref.get(recorded) }),
        Layer.succeed(VisitorSalt, { salt: Effect.succeed(salt) })
      );
    })
  );
