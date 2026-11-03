import { Schema } from "effect";

export class ContentRuleViolation extends Schema.TaggedError<
  ContentRuleViolation,
  { readonly brand: unique symbol }
>()("ContentRuleViolation", {
  cause: Schema.optional(Schema.Defect()),
  fix: Schema.String,
  what: Schema.String,
  why: Schema.String,
}) {
  override get message() {
    return `${this.what} ${this.why} Fix: ${this.fix}`;
  }
}

export const violation = (
  what: string,
  why: string,
  fix: string,
  cause?: unknown
) => new ContentRuleViolation({ cause, fix, what, why });
