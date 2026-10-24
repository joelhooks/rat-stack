import { Schema } from "effect";

export class MailerFailed extends Schema.TaggedError<
  MailerFailed,
  { readonly brand: unique symbol }
>()("MailerFailed", { reason: Schema.String }) {}
