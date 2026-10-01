import { Schema } from "effect";

export class EventSinkError extends Schema.TaggedError<EventSinkError>()(
  "EventSinkError",
  { cause: Schema.Defect() }
) {}
