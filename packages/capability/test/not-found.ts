import { Schema } from "effect";

export class NotFound extends Schema.TaggedError<
  NotFound,
  { readonly brand: unique symbol }
>()("NotFound", {
  name: Schema.String,
}) {
  override get message(): string {
    return `No one called ${this.name}`;
  }
}
