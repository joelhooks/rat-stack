import { Schema } from "effect";

export class JoinRetentionBackfillUnavailable extends Schema.TaggedError<
  JoinRetentionBackfillUnavailable,
  { readonly brand: unique symbol }
>()("JoinRetentionBackfillUnavailable", { reason: Schema.String }) {
  override get message(): string {
    return this.reason;
  }
}
