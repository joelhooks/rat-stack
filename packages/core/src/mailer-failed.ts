import { Schema } from "effect";

export class MailerFailed extends Schema.TaggedError<MailerFailed>()(
  "MailerFailed",
  { reason: Schema.String }
) {}
