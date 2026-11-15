import { Schema } from "effect";

export class NotAnAttendee extends Schema.TaggedError<
  NotAnAttendee,
  { readonly brand: unique symbol }
>()("NotAnAttendee", { message: Schema.String }, { httpApiStatus: 403 }) {}
