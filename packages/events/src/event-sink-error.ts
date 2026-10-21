import { Schema } from "effect";

export class EventSinkError extends Schema.TaggedError<
  EventSinkError,
  { readonly brand: unique symbol }
>()("EventSinkError", { cause: Schema.Defect() }) {}
