import { Schema } from "effect";

export class IntakeEventsUnavailable extends Schema.TaggedError<
  IntakeEventsUnavailable,
  { readonly brand: unique symbol }
>()("IntakeEventsUnavailable", {}) {}
