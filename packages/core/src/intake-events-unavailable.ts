import { Schema } from "effect";

export class IntakeEventsUnavailable extends Schema.TaggedError<IntakeEventsUnavailable>()(
  "IntakeEventsUnavailable",
  {}
) {}
