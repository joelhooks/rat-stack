import { Schema } from "effect";

export class NotFound extends Schema.TaggedError<
  NotFound,
  { readonly brand: unique symbol }
>()("NotFound", {
  subject: Schema.String,
}) {
  override get message(): string {
    return `No one called ${this.subject}`;
  }
}
